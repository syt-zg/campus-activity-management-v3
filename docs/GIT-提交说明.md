# Git 提交说明与仓库地址

> 对应实验要求「六、实验提交内容」第 1 条：**附运行说明及可访问的 Git 仓库地址**。
> 运行说明见 `README.md` 与 `源代码说明.txt`；本文件说明仓库状态、提交历史与推送步骤。

## 一、当前状态（必须补的一步）

```text
本地仓库：已初始化，分支 master，工作区干净（完整历史用 `git log --oneline` 查看）
远程仓库：尚未配置  ← 提交要求中的"可访问的 Git 仓库地址"依赖这一步
```

**这一步只能由本组完成**（需要你们的 GitHub / Gitee / 学校 GitLab 账号）。
推送完成后，把仓库地址填到 `README.md` 第五节和交付目录的 `交付说明.txt` 里。

## 二、推送步骤（三行命令）

在 `source` 目录执行，`<URL>` 替换为你们新建的空仓库地址：

```bash
git remote add origin <URL>
git push -u origin master
git remote -v          # 确认地址已生效
```

注意：

- 仓库建成**空仓库**再推（不要勾选自动生成 README，否则要先 `git pull --rebase`）。
- 公开或私有均可，私有仓库需给评审批次访问权限，否则不算"可访问"。
- 如果学校要求分支名为 `main`：`git branch -M main` 后再推送。

### 附：没有远程仓库时的过渡方案（git bundle）

交付目录里额外提供了 `source-history.bundle`（约 770 KB），
它是**一个文件里装下完整提交历史**的 Git 包，可在任何平台导入：

```bash
# 1) 在托管平台新建空仓库后
git clone <空仓库地址> campus-v3 && cd campus-v3

# 2) 把 bundle 里的历史拉进来
git pull ../source-history.bundle master

# 3) 推上去
git push -u origin master
```

校验完整性：`git bundle verify ../source-history.bundle` → 应显示 "records a complete history"。
这样即使暂时没有仓库，提交历史也不会丢，之后随时可以补推。

## 三、提交历史（评审可直接核对，下表为主要节点）

| 提交 | 时间 | 内容 | 规模 |
|---|---|---|---|
| `9231ee0` | 2026-10-18 20:46 | `chore: V2.0 基线（实验三起点）` —— 把收到的 V2.0 原样入库，作为对照基线 | 30 文件 / 7700 行 |
| `a99c148` | 2026-10-18 20:54 | `feat(v3): 过程数据留痕与候补闭环` —— 事件日志、资格校验、递补确认窗口、取消原因、出席、导出、运行统计 | 11 文件 / +1005 −63 |
| `7dc141c` | 2026-10-18 21:06 | `docs(v3): 变更说明、验证记录、测试脚本与源代码说明` | 4 文件 / +454 −6 |
| `c32efe8` | 2026-10-18 21:20 | `feat(v3.1): 对照模拟数据包的数据驱动调整` —— 数据发现报告、错峰开放、请求幂等、写入合并、候补深度提示 | 23 文件 / +17051 −60 |
| `e43f95b` 及其后 | 2026-10-18 21:48 起 | `docs: 补齐提交要求缺口` 等文档同步提交 —— README 总入口、AI 使用说明、Git 提交说明，jsdom 缺失时优雅跳过 | 5 文件 |
| `5e69ddd` | 2026-10-19 18:45 | `fix: 移除误导构建的 pnpm 产物，补齐脚本与运行说明` —— 删掉 `pnpm-lock.yaml`（它会让 electron-builder 误判包管理器并调用 pnpm，源码构建直接失败）、补齐 `start` / `test` / `build:installer` 脚本、README 改为 npm 步骤 | 5 文件 / +16 −2801 |

**为什么第一步是"V2.0 基线"**：只有这样，"主要修改过程"才是可对比的 ——
评审用 `git diff 9231ee0 c32efe8` 就能看到 V2.0 → V3.0 的全部改动，
而不是看到一个已经改完、无法追溯的成品。

## 四、评审可以这样核对

```bash
git log --oneline --stat            # 看每次提交改了什么、改了多少
git diff 9231ee0 --stat             # V2.0 基线到当前的全部变化
git show a99c148 -- src/app.js      # 看核心功能的实现改动
git log --oneline -- public/        # 只看界面改动
```

## 五、提交规范

提交信息统一用 `类型(范围): 说明` 的形式，类型含义：

| 类型 | 含义 |
|---|---|
| `chore` | 基线、构建、杂项 |
| `feat` | 新增功能 |
| `docs` | 文档 |
| `fix` | 缺陷修复（交付前的构建可用性修复单独成一次提交，见 `5e69ddd`） |

## 六、仓库里没有的东西（刻意排除）

`.gitignore` 已排除：`node_modules/`、`release-single/`、`*.log`、`data/*.backup`，
以及 `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `yarn.lock`（本项目统一用 npm，
残留的 pnpm 锁文件会让 electron-builder 误判包管理器）。
打包产物（exe）不进仓库，随交付目录一起提交即可；`analysis/data/` 里的教师模拟数据
是只读的分析输入，保留在仓库中以支撑"关键分析依据可复核"。
