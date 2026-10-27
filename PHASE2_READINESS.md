# 第二阶段准入评估

日期：2026年10月27日。分支：`baseline/consolidation-phase1`。

功能基线：`3d738981eb484a96b2a80d57608496800eacfa29`；修复参照：`1f0f1f04d4a3cd73cc21d57d7d6fdbcc6e258f49`。最终代码与测试工具提交：`6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`；报告归档提交另见本分支后续 docs 提交。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase1/VFIB-Marketing-OS`。原工作树及业务数据未更改，应用仍0.1.6、schema8；未合并、迁移、部署或发布。

## 准入结论

四项授权修复代码已完成，专项57项及原有回归880项通过；完整阶段验收仍受限。不得自动进入第二阶段，不具备无条件生产集成或发布资格。

## 已具备的复核条件

- 独立分支、工作树、四项可回溯提交和完整测试工具。
- 修改前加密一致备份与恢复校验，原树代码和业务数据哈希未变。
- H01/H02授权负例、H03真HTTP500与恢复、H07真实浏览器错误保护证据。
- V0.1.6 Provider、预算账本、视频、核心审核与Workspace消费者保留。

## 尚未满足的条件

|事项|本阶段状态|进入后续阶段前需要的决定或工作|
|---|---|---|
|T09乱序响应 M05|仍失败，未修复|人工确认是否在后续阶段授权移植情报epoch保护|
|H06损坏恢复|仅隔离方案通过；生产仍有自动重建行为|单独授权生产fail closed及恢复机制设计，不得偷偷扩大本轮|
|H04模型出站|未改|固定DNS连接、重定向及正文限额治理|
|H05资料分级|未改|可信元数据与executive映射、未知分级拒绝|
|真实Workspace|未测试|双方授权、合法账号、scope与撤回正负例，不修改共享契约迁就错误|
|数据库生产化|未执行|单实例边界、事务存储与后台worker另行设计|

因此建议人工先审核本阶段差异、T09/H06处置及回滚条件，再明确第二阶段范围。Postiz、Activepieces与Directus均未安装；未连接社媒、调用真实厂商或发布新版本。

## 下一阶段候选任务  不构成执行授权

先解决M05的乱序响应和H04/H05模型网关边界；H06需单独批准的恢复方案。完成新的负例回归与Workspace联调后，再评估一个品牌、一个渠道的Postiz隔离PoC。Activepieces只获得受控任务上下文，不直连库、不持万能票据；Directus继续暂缓。

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

