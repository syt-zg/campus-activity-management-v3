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
| `tests/v3-smoke.js` | ~180 | 后端冒烟测试：29 项断言，覆盖资格、候补、递补、超时、出席、导出、统计、日志、回归 |
| `tests/ui-render.js` | ~150 | 前端渲染测试（jsdom）：18 项断言，逐视图检查是否抛异常、关键元素是否存在 |

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
# 1. 后端冒烟（29 项）
node tests/v3-smoke.js

# 2. 前端渲染（18 项，需先启动服务）
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
| 验证调整是否合理 | `tests/v3-smoke.js` 29 项 + `tests/ui-render.js` 18 项，可复跑 |
| AI 工具使用 | 改动过程与判断依据记录在本文档与提交信息中，关键结果用测试脚本核对 |
