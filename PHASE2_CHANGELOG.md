# Phase 2 整改变更记录

日期：2026-10-27。分支：`baseline/consolidation-phase2`。业务修复最终提交：`e21da0a`；最后专项测试提交：`bf27962`；报告和原始证据为本分支后续归档提交。

功能主干为 `3d738981eb484a96b2a80d57608496800eacfa29`；第一阶段代码为 `6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`，报告归档与完整回滚点为 `319c5b3f357a8bfc077554e0f95b8ff00c3798df`。已核实提交祖先关系、原树及第一阶段工作树 clean 后创建独立第二阶段工作树。应用保持 **0.1.6 / schema8**。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase2/VFIB-Marketing-OS`。所有数据实验使用操作系统临时目录中的合成数据；未读取配置用于真实模型调用，未更改生产数据、密钥、Enterprise Workspace、双系统正式契约或历史分支。未部署、发布、推送 GitHub 或进入第三阶段。

命令中的 `$node` 指 `C:/Users/three/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`（v24.19.0），从上述工作树执行。JSON、原始日志及截图均在 `TEST_EVIDENCE_PHASE2/`。

## 变更与回滚点

|事项|提交|原始缺陷与变更|影响模块|
|---|---|---|---|
|H06|d14b6ab|损坏 JSON/未来 schema 曾被改名并播种空库；现抛 MOS_DATABASE_LOAD_BLOCKED，保留原文件；schema8 有效加载不再重写|store.load|
|M05/T09|ac556a9|旧请求及旧弹窗回调可作用到新品牌；现以品牌、host 和 epoch 绑定读取、渲染及写入回调|情报流、来源、研究、选题页面|
|H04|28284c4|地址校验与 fetch 连接分离、跟随跳转、正文无完整超时和大小约束；现统一固定 DNS 的原生 HTTP(S) 传输|文本、图片、视频、搜索及媒体下载|
|H05|75ddf13|高管/未知密级可能退回 PUBLIC，任务引用未在外发前实时授权；现引入严格映射及资料库权威复核|egress、Workspace AI 策略、创作/视频调用上下文|
|补充及验证|285f40f|搜索外发同样执行分级/引用检查；保留上游 HTTP/结构化错误，隐藏上游原始正文；浏览器和适配器测试|搜索、测试工具|
|H06/H05补充|ba8d935|生产缺库禁止自动播种；新库首次落盘失败清空内存；显式失效权限拒绝；加密备份和回滚验证|加载器、资料策略、恢复测试|
|错误说明|e21da0a|未知/高管机密阻断不再提示管理员可以豁免；补齐7项加载器前后证据|文本/图片错误提示、测试|
|复现实验|bf27962|通过 git show 在 VM 读取旧情报源码，重现原始5项失败，不编辑业务源码|M05工具|

H04/H05/H06 为针对当前功能主干的增量实现；M05 参考 `1f0f1f0` 的 epoch 思路并扩展到延迟写回调。没有整目录覆盖。每项独立提交均保留父提交，可在独立审阅/回滚分支检查；相互依赖补丁不应盲目逐个反向应用。

## 测试命令与结果

```powershell
& $node tools/phase2/egress-test.js
& $node tools/phase2/workspace-policy-test.js
& $node tools/phase2/adapter-policy-test.js
& $node tools/phase2/storage-test.js
& $node tools/phase2/intelligence-test.js
& $node tools/phase2/browser-intelligence-test.js
& $node tools/phase2/run-phase1-regression.js
& $node tools/phase2/run-regression.js
& $node tools/phase2/rollback-test.js
```

上述结果均通过。首次全回归保留 `regression-first-run/`：879/880，旧 PC-18 断言要求展示供应商错误原文；按 H04 更新为保留 HTTP 500/结构化错误且不泄露正文，随后完整17套均880通过；最终错误文案调整后又单独运行26项 Provider 契约验证（provider-contract-final.log）。没有删用例或跳过失败来获得通过。

## 尚未解决

剩余 H03 仅完成分类，不宣称全系统事务。真实外部授权、真实 TLS 供应商握手与生产验收未完成。正式契约文件及共享客户端保持不变；缺少可信外发元数据的现有服务将被阻断，须在后续获授权联调中核实。

## 验证分层及共同限制

- 本地模拟/组件：H04 安全 13/13，H05 策略 22/22、真实适配器入口负例 3/3，H06 加载/恢复 7/7，M05 组件 6/6。
- 隔离服务集成：原有 17 套回归 880/880；第一阶段保护回归 57/57（其中真实 Chrome 草稿流程 5 项）。第二阶段真实 Chrome 品牌切换 2/2。第二阶段专项合计 53/53；加上上述回归共 990 个断言/用例通过，不代表 990 个独立业务场景。
- 真实外部服务：**NOT VERIFIED / BLOCKED**，未调用真实模型、搜索、企业资料库服务或社媒服务。Workspace 策略测试替身、HTTP 本地桩、TLS 请求参数替身均明确区分，不能作为真实供应商验收。
- 生产验收：**未执行，待人工审核**。仍有异步持久化及跨文件/跨服务一致性风险，见存储风险清单。备份依赖当前 Windows 用户的 DPAPI；不能证明跨机器灾备。
