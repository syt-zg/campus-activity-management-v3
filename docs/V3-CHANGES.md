# 校园活动管理系统 V3.0 变更说明

> 实验三《基于运行数据的需求演化》交付物配套文档
> 基线：V2.0（`release v2.0`，Git 首个提交 `9231ee0`）
> 本文档对应提交：`feat(v3): 过程数据留痕与候补闭环`

## 一、这一版要解决的问题（工程意图）

V2.0 的业务主干是完整的（三角色、报名四状态、候补队列、自动递补、审核、平台监管），但它有一个结构性缺口：**系统只保存最终状态，不保存过程**。

全量检索 V2.0 源码，`签到 / 出席 / 通知 / 统计 / 趋势 / 反馈 / 日志 / 埋点 / 取消原因` 命中数全部为 0。这意味着：

- 报名之后到底来没来，系统答不出来；
- 学生为什么退出，系统答不出来；
- 名额是空置还是被长期占住，系统答不出来；
- 活动多了以后接口是否变慢，系统答不出来。

因此每一轮"基于运行数据演化"都只能靠外部数据包喂。V3.0 的工程意图是：**让系统自己产数据，并把已经承诺却没落地的规则补上**，形成"数据 → 决策 → 迭代 → 验证"的内部闭环。

## 二、新增功能（7 项）

| # | 功能 | 解决的问题 | 主要位置 |
|---|------|-----------|---------|
| 1 | **运行事件日志** | 全过程无留痕，无法复盘与统计 | 新增 `src/events.js`；`src/app.js` 各接口埋点 |
| 2 | **报名资格规则生效** | V2.0 的 `eligibility` 只存文本、从不校验（R08 名存实亡） | `src/app.js` join 接口；`eligibilityRule` 字段 |
| 3 | **递补确认窗口** | 递补"直接到账"，名额可能被一直占住 | `promoteFromWaitlist` + `settleActivity` |
| 4 | **确认超时自动释放并顺延** | 候补队列无法自愈 | `settleActivity` 惰性结算 |
| 5 | **取消原因留痕** | 取消后记录被删除，原因永久丢失 | `activity.cancellations` + 取消接口接收 `reason/note` |
| 6 | **出席状态（签到的最小实现）** | 无法算爽约率，教师也无从记录到场情况 | `registration.attended/checkinTime` + `PUT /checkin` |
| 7 | **教师名单 CSV 导出** | 线下活动需要打印/签到的名单 | `GET /api/activity/:id/export` |

配套的界面能力：

- 管理员新增 **运行统计** 页（6 项指标卡 + 报名漏斗 + 取消原因分布 + 按类型聚合 + 近 N 天趋势 + 最近事件）；
- 管理员新增 **运行日志** 页（按类型筛选、分页）；
- 学生端新增 **待确认名额** 提示与「确认名额」按钮，取消报名必须选择原因；
- 教师端名单弹窗新增 **出席列 / 标记出席 / 导出 CSV / 资格限定提示 / 已取消流水**。

## 三、修改的既有行为（4 处，均为修复性质）

| 改动 | V2.0 行为 | V3.0 行为 | 依据 |
|------|----------|----------|------|
| 删除活动 | `filter` 抹掉活动，报名与候补历史一并消失 | 改为**归档**（`archived`），列表不再展示但历史保留 | 数据不可回溯会让"复盘上一轮改动"失效 |
| 活动开始后取消报名 | 只拦"已结束"，"进行中"仍可取消 | 只允许**开始前**取消；开始后由教师记录出席 | 开始后取消会让名额递补给已开始的活动，且真实缺席应体现在出席率上 |
| 时间戳 | `nowText()` 返回 UTC 文本 | 统一为本地时间 | 界面"申请时间"比实际早 8 小时，且与递补截止时间无法直接比较 |
| 版本号 | `package.json` 3.1.0 / 接口 V2.0 / 页面 V2.0 | 全部统一为 3.0.0 / V3.0 | 文档与实现一致性 |

## 四、明确没做的（实施边界）

| 未做项 | 原因 |
|--------|------|
| 真实推送通知（短信/邮件/系统通知） | 桌面单机版没有服务端外通道，硬做只能是假通知；改为登录后的首页提示 + 状态标记 |
| 统计大屏/图表库 | 与已有指标页重复，投入产出比低 |
| 列表分页 | 当前数据量级（21 个活动）体现不出效果，属于"下一轮" |
| 迁移到 SQLite | 真问题但回归面大，需单独一轮迭代 |
| 批量审核 | 数据未支持"审核堆积"结论，等拿到模拟数据再决定 |

## 五、新增/修改的代码清单

### 新增文件

| 文件 | 行数量级 | 作用 |
|------|---------|------|
| `src/events.js` | ~130 | 事件日志：`logEvent` / `readEvents` / `allEvents` / `localText` / `EVENT_TYPES`，JSONL 追加写，超 5 MB 自动滚动 |
| `tests/v3-smoke.js` | ~430 | 后端冒烟测试：51 项断言，覆盖资格、候补、递补、超时、出席、导出、统计、日志、冲突检测、规则推送、教师建议、回归 |
| `tests/ui-render.js` | ~230 | 前端渲染测试（jsdom）：26 项断言，逐视图检查是否抛异常、关键元素是否存在 |

### 后端 `src/app.js` 新增函数

```
settleActivity(item)   递补确认窗口的惰性结算（替代定时器）
settleOne(item)        单活动结算并立即落盘
settleAll()            全量结算并落盘一次
attendedList(item)     出席统计辅助
hoursLater(hours)      计算确认截止时间
```

### 后端 `src/app.js` 修改的函数

```
migrateActivity      新增字段归一（eligibilityRule / archived / cancellations / confirmDeadline / confirmedTime / attended）
promoteFromWaitlist  递补时写入 confirmDeadline，不再"直接到账"
activityView         增加 cancelledCount / attendedCount / needConfirmCount
myRegistration       增加 confirmDeadline / confirmedTime / needConfirm / attended
registrationRows     增加 confirmDeadline / confirmedTime / needConfirm / attended / checkinTime
activitySummary      增加 attendedCount / cancelledCount / needConfirmCount / eligibilityRule
nowText              改为本地时间
server 请求处理       增加慢请求（≥100ms）事件记录
```

### 新增接口

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/activity/:id/confirm` | 学生 | 确认递补名额 |
| PUT | `/api/activity/:id/checkin` | 教师 | 标记出席 / 未出席 |
| GET | `/api/activity/:id/export` | 教师 | 导出名单 CSV（UTF-8 BOM，Excel 可直接打开） |
| GET | `/api/admin/metrics?days=N` | 管理员 | 运行统计聚合 |
| GET | `/api/admin/events?type=&limit=&offset=` | 管理员 | 事件日志查询 |

### 接口行为变更

- `POST /api/activity/:id/join`：新增资格校验（不匹配返回 403 并记 `join_blocked`）；
- `DELETE /api/activity/:id/join`：新增请求体 `{ reason, note }`，写入取消流水；限制改为"活动开始前"；
- `GET /api/activity/:id/joinlist`：新增返回 `cancellations` 与 `confirmHours`；
- `DELETE /api/activity/:id`：改为归档，保留历史；
- `GET /api/admin/overview`：新增 `archivedCount / registrationCount / cancelCount / eventCount`；
- `GET /api/health`：`version` 返回 `V3.0`。

### 前端新增/修改

| 文件 | 改动 |
|------|------|
| `api.js` | 新增 `confirmSeat / checkin / downloadJoinList / adminMetrics / adminEvents`；`cancel` 支持请求体 |
| `student.js` | 新增 `confirmSeat`；`cancelSignup` 支持原因参数 |
| `teacher.js` | 新增 `setCheckin / exportSignupList`；`toApiData` 增加 `eligibility_rule` |
| `admin.js` | 新增 `getMetrics / getEvents` |
| `app.js` | 新增 `renderAdminMetrics / renderAdminEvents / metricCard / eventTypeTag`；菜单增加两项；名单弹窗、取消弹窗、活动表单、我的活动卡片改造 |
| `index.html` | 页面标题与版本号改为 V3.0 |

## 六、数据模型变化

```text
activity
  + eligibilityRule : string    可判定的资格关键词（班级/年级）
  + archived        : boolean   软删除标记
  + archivedTime    : string
  + cancellations[] : { userId, real_name, time, reason, previousStatus }

registration
  + confirmDeadline : string    递补确认截止时间（仅递补者）
  + confirmedTime   : string    学生确认时间
  + attended        : true|false|null
  + checkinTime     : string

新增数据文件
  events.jsonl          一行一事件（追加写，5 MB 滚动为 events.archive.jsonl）
```

旧数据无需迁移：`migrateActivity` 在读取时补齐默认值，未改动磁盘上的既有记录。

## 七、如何验证

```bash
# 1. 后端冒烟（51 项）
node tests/v3-smoke.js

# 2. 前端渲染（26 项，需先启动服务）
node src/app.js            # 另开终端
NODE_PATH=<jsdom 所在 node_modules> node tests/ui-render.js http://127.0.0.1:3000
```

两项测试的实际输出见 `docs/V3-VERIFY.md`。

## 八、与实验三要求的对应

| 任务要求 | 本版对应物 |
|---------|-----------|
| 分析数据发现问题 | 管理员"运行统计"提供 6 类口径；拿到模拟数据包后先对齐字段映射，再决定下一轮 |
| 自主确定需求与工程意图 | 见第一节；选择"过程不可观测"作为主问题，而不是堆功能 |
| 在已有项目上完成迭代 | 全部改动在 V2.0 代码上完成，保留原有业务主干；Git 分两次提交（基线 + 功能） |
| 验证调整是否合理 | `tests/v3-smoke.js` 51 项 + `tests/ui-render.js` 26 项，可复跑 |
| AI 工具使用 | 改动过程与判断依据记录在本文档与提交信息中，关键结果用测试脚本核对 |

---

## 九、拿到模拟数据包后的追加改动（第二轮）

数据包到手后做了实测（`analysis/analyze.py`，报告见 `analysis/REPORT-数据发现.md`）。
**结论修正了一处初始判断**：候补转化率 14.8% 看起来像"递补机制没闭环"，但取消 130 条、
递补成功 130 条，说明机制本身没漏——真正的问题是候补池深度达到释放名额的 6.7 倍。
因此本轮不再加强递补自动化，改为解决"等待预期"和"峰值压力"。

### 9.1 新增功能（5 项）

| # | 功能 | 数据依据 | 代码位置 |
|---|------|---------|---------|
| 1 | **报名开放时间（错峰）** | 24 个活动只有 09:00/18:00 两个开放时刻，42.8% 的报名发生在开放当小时 | `activity.registrationOpen`、`signupOpen()`、join 校验 |
| 2 | **报名请求幂等** | 126 条 `duplicate`，100% 对应 `client_retry=1` | `IDEMPOTENCY`、`requestId`、`join_duplicate` 事件 |
| 3 | **写入合并 + 备份降频** | 09:00 时段 P50 由 210ms 升至 850ms、42.4% 慢请求 | `queueWrite` / `flushWrites` / `BACKUP_INTERVAL_MS` |
| 4 | **候补深度提示** | 热门活动候补达名额 3～5 倍，整体转化率 14.8% | `waitlistDepth` 响应、卡片提示、`waitlistPressure` 统计 |
| 5 | **接口耗时采样** | 只记慢请求会产生采样偏差，P50 不可信 | `PERF` 环形缓冲、`perfSummary()`、统计页两张卡 |

### 9.2 对照实验（前后对比）

`node tests/perf-compare.js`：同一负载（60 并发报名）、同一机器、3 轮平均。
`WRITE_COALESCE_MS=0`（等价 V2.0 同步写）→ `50`（V3.0 合并写）：

```text
同步写(≈V2.0)  总耗时 628ms  P50 618ms  P95 623ms  落盘 61 次
合并写(V3.0)   总耗时 223ms  P50 215ms  P95 219ms  落盘  2 次
变化：-64% 总耗时，落盘次数 61 → 2
```

### 9.3 数据包与代码的对照产物

| 文件 | 作用 |
|---|---|
| `analysis/analyze.py` | 可复跑的数据发现脚本（描述性统计 + 口径声明） |
| `analysis/REPORT-数据发现.md` | 数据发现报告（事实/推测分开标注） |
| `analysis/字段映射.md` | 数据包字段 ↔ 系统字段对照，标出 3 处能力缺口 |
| `analysis/data/` | 教师提供的原始 CSV（只读，不参与运行） |
| `tests/perf-compare.js` | 写入合并前后对比 |

### 9.4 由数据反证"不该做"的两项

- **移动端适配**：埋点里 mobile 占 70.9%，但本组是 Electron 桌面程序，
  该比例来自教师构造的另一套平台，**不可外推**，本轮不做。
- **容量冲突处理**：数据包有 41 条 `capacity_conflict`，但本系统单进程串行、
  检查与写入之间没有 await，不产生该竞态，**不新增人为分支**，只在文档中说明差异。

### 9.5 数据模型补充

```text
activity
  + registrationOpen : string   报名开放时间（空=发布即可报名，兼容 V2.0）
```

事件类型新增：`join_duplicate`（重复提交去重）、`join_too_early`（未到开放时间）。

## 十、能力扩展（第三轮）

前两轮解决"看得见"与"稳得住"。这一轮按活动生命周期重新检视能力分布，
发现两个阶段（评价、调控）基本空白，且时间维度全线缺失、系统从不主动做任何事。
完整依据见 [`V3-能力扩展设计.md`](V3-能力扩展设计.md)。

### 10.1 数据依据（三组证据互证）

| 证据源 | 关键事实 |
|---|---|
| 反馈文本（112 条，26 个模板） | 状态变化无感知 33 条（29.5%）居首；报名失败原因不明 19 条；筛选困难 12 条 |
| 行为埋点（11027 条 / 1416 session） | 进入列表的 session 100% 都会打开详情；状态页被访问 293 次 |
| 业务记录（报名 2878 / 候补 1006） | 876 人候补仅 130 人转正，**746 人（85.2%）无终态**；**39.7% 学生存在时间重叠报名**；5 个满员活动合计 701 人排队而 7 个活动空 92 位 |

### 10.2 新增能力（3 个维度）

**① 时间能力——从"活动视角"到"个人时间视角"**

- `GET /api/schedule?weekStart=` 个人周历：按周聚合本人报名，标出同日时间重叠组
- 报名接口内联冲突检测：与已报活动重叠时返回 409 与冲突清单（活动、重叠分钟数），
  前端展示后可由用户确认并带 `force` 重提；拒绝路径不写入幂等缓存
- 活动列表新增 `weekday`（1=周一 … 7=周日）与 `slot`（morning/afternoon/evening/night）筛选

**② 系统主动性——从"请求驱动"到"事件与时间驱动"**

- `src/rules.js`：规则以 `match / emit` 描述，产出带 `dedupeKey` 的消息，纯计算便于单测
- 四条规则：`waitlist_final`（候补终局）、`waitlist_near`（临期排位）、
  `activity_reminder`（开始提醒）、`capacity_shortage`（供给不足建议）
- 触发路径：30 秒心跳 + 请求惰性触发，两路共用节流窗口；定时器 `unref()`
  不阻塞进程退出。桌面端可能休眠，因此不以定时器作为唯一路径
- `GET /api/messages`、`GET /api/messages/unread`、`POST /api/messages/read`
- 前端新增"消息中心"，三个角色均可见

**③ 供给侧分析——教师首次获得效果反馈**

- `GET /api/teacher/insights`：逐活动输出报名率、候补压力、出席率、取消率，
  并给出"建议扩容 / 建议调整时段 / 维持"的判断与理由
- 前端新增"活动效果"页

### 10.3 代码清单

| 类型 | 内容 |
|---|---|
| 新增文件 | `src/rules.js`（规则引擎）、`docs/V3-能力扩展设计.md`（设计依据） |
| 后端新增函数 | `pushMessage`、`runRules`、`userMessages`、`markMessagesRead`、`weekdayOf`、`slotOf`、`myActiveActivities`、`conflictsWithSchedule`、`scheduleOf`、`teacherInsights`、`startHeartbeat`、`stopHeartbeat` |
| 后端修改 | `fail()` 增加 `data` 参数以返回结构化冲突；列表接口增加星期/时段过滤；报名接口插入冲突检测；`startServer` / `stopServer` 接入心跳 |
| 前端新增 | `renderStudentCalendar`、`renderMessages`、`renderTeacherInsights`、`showConflictConfirm`；菜单增加"我的日程""消息中心""活动效果"；首页筛选增加星期与时段 |
| 接口封装 | `Api.messages`、`Api.markMessagesRead`、`Api.unreadCount`、`Api.schedule`、`Api.teacherInsights`；请求失败时把 `data` 挂到 error 上 |

### 10.4 数据模型补充

```text
messages（新增文件 messages.json）
  id / userId / role / type(info|warn|action) / title / content
  activityId / ruleId / dedupeKey / read / createTime
  —— 单用户上限 200 条，超出优先淘汰已读旧记录

事件类型新增：join_conflict（冲突拦截）、join_conflict_forced（确认后继续）、
              message_push（规则推送）、rule_run（规则执行）
```

### 10.5 本轮明确不做

- **个性化推荐**：402 名报过两个以上活动的学生中仅 6 人（1.5%）集中在单一类型，
  无稳定兴趣画像基础；应做筛选而非推荐。
- **移动端适配**：行为占 70.9%，但属整套界面改造，与"能力扩展"主线不同。
- **活动后评价闭环**：需要独立的时间窗口与评价数据表，留待下一轮。

### 10.6 验证

后端断言由 37 项增至 51 项，前端渲染由 20 项增至 26 项，全部通过。
新增覆盖：冲突拦截与确认后重提、周历七天结构与重叠识别、星期/时段筛选一致性、
候补终局消息生成、重复扫描不重复推送、供给不足送达管理员、消息已读、
教师建议分类（建议扩容 / 建议调整时段）、三个新页面渲染无异常。
实际输出见 [`V3-VERIFY.md`](V3-VERIFY.md)。
