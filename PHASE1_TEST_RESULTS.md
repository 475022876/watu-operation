# 第一阶段测试结果

日期：2026年10月27日。分支：`baseline/consolidation-phase1`。

功能基线：`3d738981eb484a96b2a80d57608496800eacfa29`；修复参照：`1f0f1f04d4a3cd73cc21d57d7d6fdbcc6e258f49`。最终代码与测试工具提交：`6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`；报告归档提交另见本分支后续 docs 提交。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase1/VFIB-Marketing-OS`。原工作树及业务数据未更改，应用仍0.1.6、schema8；未合并、迁移、部署或发布。

## 最终结果

|验证组|结果|证据|
|---|---|---|
|H01 T01|9/9|h01.json|
|H02 T02|6/6|h02.json|
|H03及T07|16/16|h03.json|
|H07组件|10/10|h07-component.json|
|T04隔离阻断恢复与遗留观测|6/6|t04-isolated.json；不等于生产H06已修复|
|真实HTTP持久化与幂等|5/5|http-durability.json|
|真实Chrome故障流程|5/5|browser/results.json及PNG|
|原有回归|17套件880/880|regression/summary.json及各套件log|
|T09情报乱序响应|KNOWN_FAIL_OUT_OF_SCOPE|t09-observation.json|

专项通过总数57，回归880；不把T09纳入通过数。T09观测脚本退出0仅说明完成了复现，结果字段明确失败。

## 回归明细

|套件|通过数|退出码|
|---|---:|---:|
|mos-unit-test|76/76|0|
|mos-smoke-test|15/15|0|
|mos-security-egress-test|17/17|0|
|mos-scheduler-test|20/20|0|
|mos-provider-contract-test|26/26|0|
|mos-provider-admin-test|70/70|0|
|mos-workspace-contract-test|36/36|0|
|mos-dual-identity-test|51/51|0|
|mos-e2e-test|48/48|0|
|mos-e2e-build02|63/63|0|
|mos-e2e-build03|96/96|0|
|mos-e2e-v012-research|55/55|0|
|mos-e2e-v012-editorial|43/43|0|
|mos-e2e-v013-studio|29/29|0|
|mos-e2e-v013-research|79/79|0|
|mos-i18n-check|21/21|0|
|mos-ui-check|135/135|0|

## 执行环境与失败记录

最终使用捆绑Node v24.19.0、Windows、本机真实Chrome和独立数据目录。无第三方依赖安装；只有本地回环HTTP夹具，无真实厂商、Workspace或社媒访问。原始数据未用于带真实凭据的应用启动。

首轮运行15/17套件正常：测试启动器强制MOS_IMAGE_PROVIDER等为none，干扰Provider测试的单位配置；Workspace测试36项断言通过后Node v24.15.0发生UV_HANDLE_CLOSING退出异常。第二轮取消强制none、加测试出站闸门后，Provider70/70通过，但闸门初版阻止了“公共域名绑定回环”的DNS夹具，Workspace退出异常仍在。保留initial-regression和second-regression全部记录；最终闸门核验实际lookup为回环，改用v24.19.0，17套件正常退出。

H03首版测试夹具缺prefs触发migrate返回true；改为先补形状再断言二次幂等。未为迁就测试修改生产迁移逻辑。H07浏览器初版截图显示登录层，已纠正测试启动和可见性，并重新运行查看截图。以上失败都不作为最终通过依据，也没有删除业务或审核规则。

## 指定测试覆盖

- T01、T02：作用域、请求等价性、撤权和负责人品牌权限。
- T03：write/rename错误、异常中断、HTTP500、重试恢复、序号与审计恢复。
- T04：有效副本、坏JSON拒绝、未来schema拒绝、恢复字节一致及既有H06行为观测。前置检查仅为测试工具。
- T07：旧rowVersion拒绝锁定、manifest绑定、冻结不可改；既有e2e02/e2e03涵盖职责分离和审核门禁。
- T08：组件与可见Chrome的保存失败、未发送lock、保稿及重试。
- T09：情报跨品牌乱序失败已复现；语言保护仅沿用i18n21项和原有浏览器覆盖，不宣称完成所有动态业务文本验收。

## 可重复执行的测试命令

在本分支独立工作树运行，建议使用本次验证的 Node v24.19.0：

```powershell
$node = 'C:/Users/three/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $node tools/phase1/idempotency-test.js
& $node tools/phase1/brand-permission-test.js
& $node tools/phase1/transaction-test.js
& $node tools/phase1/draft-protection-test.js
& $node tools/phase1/storage-recovery-test.js
& $node tools/phase1/http-durability-test.js
& $node tools/phase1/browser-draft-test.js
& $node tools/phase1/intelligence-race-observation.js
& $node tools/phase1/run-regression.js
```

前七项共57项通过；第八项是已知问题观测，JSON状态为KNOWN_FAIL_OUT_OF_SCOPE，进程退出0仅表示成功完成观测，不表示T09安全验收通过。回归脚本17套件880/880，通过测试专用网络后备闸门只允许回环及经核验的回环DNS固定夹具。真实厂商、真实社媒及真实企业资料库未调用。

## 尚未解决的问题与停止边界

- T09仍失败：情报页旧响应可以覆盖当前品牌展示，对应审计M05，未授权在本轮移植。它不是H05；H05是企业资料密级与模型外发映射问题。
- H06生产恢复机制未修改：原加载器在损坏文件后仍会备份broken并重新初始化。T04的安全阻断仅由测试专用前置检查在隔离副本完成，不宣传为生产H06已修复。
- H04出站固定DNS及重定向、H05 executive密级映射、预算/就绪度/日志等后续治理仍待授权处理。
- H03仅包裹批准入池、批准并安排、草稿创建、草稿更新和冻结送审；其他save路径、跨await对象引用、多进程JSON、素材与数据库跨资源一致性不在本轮保障范围。
- 已补测并修复保存后刷新期间的草稿丢失边界；没有新增已确认未修复的安全漏洞；但不能以本地测试推导全系统安全。历史幂等记录缺少摘要时保守409；新前端锁定携带可选rowVersion，旧客户端省略该字段仍兼容，后续是否强制需另议。
- 409冲突时保护草稿但未新增冲突合并界面，需人工确认服务端版本后处理；不得强制覆盖他人修改。
- 不满足整体无条件验收及自动进入第二阶段的条件。四项修复已完成，仍须人工审核范围外失败项与提交后另行授权。

