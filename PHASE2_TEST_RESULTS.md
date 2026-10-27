# Phase 2 测试结果

日期：2026-10-27。分支：`baseline/consolidation-phase2`。业务修复最终提交：`e21da0a`；最后专项测试提交：`bf27962`；报告和原始证据为本分支后续归档提交。

功能主干为 `3d738981eb484a96b2a80d57608496800eacfa29`；第一阶段代码为 `6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`，报告归档与完整回滚点为 `319c5b3f357a8bfc077554e0f95b8ff00c3798df`。已核实提交祖先关系、原树及第一阶段工作树 clean 后创建独立第二阶段工作树。应用保持 **0.1.6 / schema8**。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase2/VFIB-Marketing-OS`。所有数据实验使用操作系统临时目录中的合成数据；未读取配置用于真实模型调用，未更改生产数据、密钥、Enterprise Workspace、双系统正式契约或历史分支。未部署、发布、推送 GitHub 或进入第三阶段。

命令中的 `$node` 指 `C:/Users/three/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`（v24.19.0），从上述工作树执行。JSON、原始日志及截图均在 `TEST_EVIDENCE_PHASE2/`。

## 前后证据

|测试|修复前|修复后|证据|
|---|---|---|---|
|H04出站|7通过/6失败|13/13|h04-before.json、h04.json|
|H05原适配器撤权|0通过/3失败|3/3|h05-adapter-before.json、h05-adapter.json|
|H05密级/授权策略|单测对照4通过/18失败|22/22|h05-before.json、h05.json；before为原分级+缺失守卫替身|
|H06损坏/缺库/恢复|0通过/7失败|7/7|h06-before.json、h06.json|
|M05/T09组件|1通过/5失败|6/6|m05-before.json、m05.json|
|M05真实Chrome|本阶段新增隔离浏览器场景|2/2|browser-m05/results.json及2张截图|

H04 TLS连接参数测试替换HTTPS request函数，验证固定lookup、原主机SNI、证书校验配置；本地HTTP桩验证正文大小、超时、取消、跳转零跟随，不等于真实公网TLS验证。

## 原有17套回归

|原有套件|通过数|进程结果|
|---|---:|---|
|mos-unit-test|76|PASS|
|mos-smoke-test|15|PASS|
|mos-security-egress-test|17|PASS|
|mos-scheduler-test|20|PASS|
|mos-provider-contract-test|26|PASS|
|mos-provider-admin-test|70|PASS|
|mos-workspace-contract-test|36|PASS|
|mos-dual-identity-test|51|PASS|
|mos-e2e-test|48|PASS|
|mos-e2e-build02|63|PASS|
|mos-e2e-build03|96|PASS|
|mos-e2e-v012-research|55|PASS|
|mos-e2e-v012-editorial|43|PASS|
|mos-e2e-v013-studio|29|PASS|
|mos-e2e-v013-research|79|PASS|
|mos-i18n-check|21|PASS|
|mos-ui-check|135|PASS|

合计880/880，全部进程exitCode=0。第一轮PC-18因原文泄露断言失败的日志保留在regression-first-run，最终完整运行在regression。错误提示最后调整后provider-contract-final.log再次26/26。没有真实供应商密钥，旧套件L3明确SKIP/BLOCKED，这些跳过项不计入已通过的真实外部验证。

## 第一阶段成果复验

H01 9/9；H02 6/6；H03同步事务16/16；真实隔离HTTP持久化失败5/5；H07组件10/10；损坏副本/恢复6/6；真实Chrome草稿5/5，总计57/57。日志和JSON在phase1-regression。T04旧“允许自动播种”观察用例已改为要求安全阻断，第一阶段历史证据归档原样保留。

## 命令

```powershell
& $node tools/phase2/run-regression.js
& $node tools/phase2/run-phase1-regression.js
& $node tools/phase2/browser-intelligence-test.js
& $node tools/phase2/rollback-test.js
& ./tools/phase2/verify-existing-backup.ps1
# 只读编译319c5b3旧代码并重现失败，预期非零退出：
$env:PHASE2_BEFORE='1'
& $node tools/phase2/egress-test.js
& $node tools/phase2/adapter-policy-test.js
& $node tools/phase2/storage-test.js
& $node tools/phase2/intelligence-test.js
Remove-Item Env:PHASE2_BEFORE
```

专项正常模式命令见PHASE2_SECURITY_FIXES。回滚、备份校验均通过；未对生产执行任何恢复。当前无未解决的本地回归失败；未验证的外部服务与生产验收不能列为通过。

## 验证分层及共同限制

- 本地模拟/组件：H04 安全 13/13，H05 策略 22/22、真实适配器入口负例 3/3，H06 加载/恢复 7/7，M05 组件 6/6。
- 隔离服务集成：原有 17 套回归 880/880；第一阶段保护回归 57/57（其中真实 Chrome 草稿流程 5 项）。第二阶段真实 Chrome 品牌切换 2/2。第二阶段专项合计 53/53；加上上述回归共 990 个断言/用例通过，不代表 990 个独立业务场景。
- 真实外部服务：**NOT VERIFIED / BLOCKED**，未调用真实模型、搜索、企业资料库服务或社媒服务。Workspace 策略测试替身、HTTP 本地桩、TLS 请求参数替身均明确区分，不能作为真实供应商验收。
- 生产验收：**未执行，待人工审核**。仍有异步持久化及跨文件/跨服务一致性风险，见存储风险清单。备份依赖当前 Windows 用户的 DPAPI；不能证明跨机器灾备。
