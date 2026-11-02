# P4 测试结果

日期：2026-11-02。代码提交 `82f473b6a8ce343a2e264d9cf9fc7bf815ce2a66`。Windows、Node 24.22.1、实际 Chrome，隔离数据。

## 试点与稳定性

运行试点工具前设置 `$env:MOS_PILOT_EVIDENCE_DIR='docs/p4-employee-experience/evidence'`，避免覆盖 P3 证据。

| 命令（仓库根目录） | 通过 | 失败 | 证据 |
| --- | ---: | ---: | --- |
| `node --test tools/p3/client-test.mjs` | 14 | 0 | `evidence/client-tests.log` |
| `node --test tools/p4/draft-test.mjs` | 14 | 0 | `evidence/draft-tests.log` |
| `node tools/p3/api-test.cjs` | 21 | 0 | `evidence/api-results.json` |
| `node tools/p4/concurrency-test.cjs` | 14 | 0 | `evidence/concurrency.json` |
| `node tools/p3/browser-test.cjs` | 32 | 0 | `evidence/browser/results.json` |
| `node tools/p3/rollback-test.cjs` | 2 | 0 | `evidence/rollback.json` |
| 合计 | **97** | **0** | 不包含构建及旧回归 |

`npm run build:pilot --prefix prototypes/employee-workspace` 类型检查与构建通过。依赖未改变，没有新增安装需求；未重复宣称 P3 的依赖审计为本轮新审计。

并发测试用两个实际合成账号同时发出请求，10 轮相同 rowVersion 编辑，每轮仅一个成功、一个 409；并发送审仅生成一条审核链；并发裁决仅追加一个获胜决定；并发修订仅产生一个新版本。范围是单进程 JSON，不能解释为跨实例或 PostgreSQL 并发能力。

浏览器覆盖真实登录、Mock Provider 两轮候选、文件上传、保存、冻结、退回修订和分级审批；覆盖 409/500/断网、实际保存后丢失响应、保存中继续编辑、刷新恢复、旧品牌延迟结果、权限与跨品牌链接、损坏草稿、中英文、390px、重复点击、组合事件、快捷键、焦点、取消离开。故障由测试注入，模型由本地 Mock 返回，没有收费模型或真实互联网故障验收。

## 原 17 套与前期安全复验

`node tools/phase2/run-regression.js` 本轮 **17/17 套通过，880 检查通过、0 失败**，包含旧 UI 135/135。逐套 counts、退出码、日志和 JSON 在 `evidence/regression/`。12 项旧失败说明见 `P4_LEGACY_UI_RECONCILIATION.md`。

另执行 `node tools/phase2/run-phase1-regression.js`，7 套均退出 0，覆盖 H01/H02/H03/H07、损坏恢复和真实浏览器草稿；归档 `evidence/phase1/`。以下独立安全测试均为本轮新执行：

| 脚本 | 通过 / 失败 |
| --- | --- |
| `tools/phase2/workspace-policy-test.js` | 22 / 0 |
| `tools/phase2/egress-test.js` | 13 / 0 |
| `tools/phase2/adapter-policy-test.js` | 3 / 0 |
| `tools/phase2/storage-test.js` | 7 / 0 |
| `tools/phase2/intelligence-test.js` | 6 / 0 |
| `tools/phase3a2/h05-version-reference-test.cjs` | 12 / 0 |

上述安全用例的外部权限和服务使用契约替身，没有实际 Workspace 或收费 Provider 验收。历史结果目录在归档本轮结果后恢复，未覆盖旧阶段报告。

## 开发中失败与纠正

1. 构建曾因 `history` 状态名遮蔽浏览器对象失败，但命令继续执行并用了旧 bundle。`excluded-stale-build.json` 明确标为不用于验收；改用 `window.history`，构建失败立即阻断，浏览器工具增加源码新于 bundle 时拒绝执行。最终结果来自成功构建的新包。
2. 首次 P4 扩展浏览器检查发现弹窗默认焦点仍落在确认提交；改为 showModal 后明确聚焦返回修改。失败保存在 `first-p4-run.json`。
3. 加入讨论离开保护后，原刷新等待误读旧 DOM，产生 4 项级联失败。改为等待新的 performance.timeOrigin、完整文档和目标工作区，再检查；保留 `reload-race-run.json`。没有因此删除业务负例。

最终 32/32 浏览器结果单独保存于 `results.json`；`failure-*.png` 为开发失败证据，不是最终页面。

## 未执行

真实员工无指导试用、屏幕阅读器、真实手机键盘/系统输入法、生产部署、真实 AI / Workspace / 社媒、PG 业务切换均未执行。97 与 880 不包含这些验收，且不应跨套件合并成生产可用性评分。
