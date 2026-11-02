# P3 测试与限制

日期：2026-11-02。Windows、Node 24.22.1、实际 Chrome。所有写入为独立临时数据，未操作原始业务库。

## 本轮新增检查

| 检查 | 结果 | 命令（仓库根目录） |
| --- | --- | --- |
| 客户端安全状态 / 传输 | 14 通过 | `node --test tools/p3/client-test.mjs` |
| 现有 HTTP API、真实 JSON 落盘与故障注入 | 21 通过 | `node tools/p3/api-test.cjs` |
| 实际 Chrome、真实隔离 HTTP、Mock Provider | 21 通过 | `node tools/p3/browser-test.cjs` |
| 真实重启回滚读取 | 2 通过 | `node tools/p3/rollback-test.cjs` |
| 类型检查与试点构建 | 通过 | `npm run build:pilot --prefix prototypes/employee-workspace` |

新增自动检查共 **58 项通过、0 项失败**，不计构建。`evidence/` 中保存逐例结果、请求路径记录和六张最终浏览器截图。CDP 仅记录 URL 路径和方法，没有 Cookie、Token、口令或请求正文。

另执行 `node tools/p3/before-fix.cjs`，在仅包含历史路由的临时实例中复现两项预期失败：磁盘故障时审核、修订均返回 200。修复后 API 检查均得到 500 且内存/磁盘业务状态不部分成功。保留 `api-first-run.json`：首次用例将撤权后的 404 误期望为 403，导致后续恢复角色未执行；改为接受服务端既有 403/404 拒绝语义后通过，没有放宽允许写入条件。

浏览器故障测试使用 CDP 注入 409、500、断网、延迟及“实际保存后响应丢失”；这些不冒充真实互联网故障。文件上传和审核实际经过本机 MOS 服务与磁盘；模型内容由本地 Mock Provider 返回，不是实际大模型。

## 既有 17 套本轮重跑

执行 `node tools/phase2/run-regression.js`，归档于 `evidence/regression/`。本轮 **872 通过、12 失败**，16 套零失败，旧 UI 套件 127 通过 / 12 失败。不是沿用历史数字。

随后执行 `node tools/p3/baseline-ui.cjs`：未修改 P2 基线路由和原 UI 源码在临时目录重跑同一套件，同样 127 / 12，失败名称完全一致；新增失败名称为空。见 `legacy-ui-comparison.json`。这些失败仍然是失败，不视为全部回归通过，也未删除断言。

遗留项分组：中英文旧中心名称和“系统接入”分组断言；计划日历网格/周视图入口；VFIB/UCARD 营销模板及品牌切换旧入口。需另行检查当前导航与旧测试预期，不能仅换断言文字就宣称业务恢复。P3 没有修改这些页面。

## 第一、二阶段安全复验

- `node tools/phase2/run-phase1-regression.js`：7 套退出码均为 0，包括派工幂等、品牌制作权限、事务、HTTP 持久化、草稿、损坏恢复和真实浏览器草稿测试；归档 `evidence/phase1/`。
- `node tools/phase2/workspace-policy-test.js`：22 / 0。
- `node tools/phase2/egress-test.js`：13 / 0。
- `node tools/phase2/adapter-policy-test.js`：3 / 0。
- `node tools/phase2/storage-test.js`：7 / 0。
- `node tools/phase2/intelligence-test.js`：6 / 0。
- `node tools/phase3a2/h05-version-reference-test.cjs`：12 / 0。

安全检查涉及的 Workspace / Provider 都是本地契约替身，不是外部真实服务。历史证据目录在归档本轮结果后恢复至原 Git 内容，避免覆盖前阶段报告。

## 尚未执行与验收结论

未执行真实付费 AI、企业资料库真实联调、社媒、生产数据、PG 切换、真实员工无指导试用、屏幕阅读器/真实手机键盘验收。P2 原型全部重新回归不在本轮结果内；P2 模拟源码未修改，只有新增 P3 源文件及构建脚本。

结论：允许审查文字 API 试点工程与隔离演示；不能宣称生产验收或 17 套全绿，不能据此自动替换原入口、启用真实模型或进入 P4。
