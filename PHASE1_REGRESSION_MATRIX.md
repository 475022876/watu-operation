# 第一阶段回归矩阵

日期：2026年10月27日。分支：`baseline/consolidation-phase1`。

功能基线：`3d738981eb484a96b2a80d57608496800eacfa29`；修复参照：`1f0f1f04d4a3cd73cc21d57d7d6fdbcc6e258f49`。最终代码与测试工具提交：`6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`；报告归档提交另见本分支后续 docs 提交。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase1/VFIB-Marketing-OS`。原工作树及业务数据未更改，应用仍0.1.6、schema8；未合并、迁移、部署或发布。

## 能力保留矩阵

文件等同性以TEST_EVIDENCE_PHASE1/protection-and-capability-integrity.json为准；应用仍0.1.6，schema8，未自动创建发布版本。

|必须保留能力|变更判断|验证|
|---|---|---|
|Master Topic与内容日历|topics/plans未改；editorial仅安全加固|editorial43、研究55、studio29|
|发布日历与内容归档|publishing未改|e2e02 63、e2e03 96、浏览器135|
|内容版本管理|增加有限提交和送审版本并发检查|事务16、e2e02/03|
|专业审核及发布审批|reviews、reviewlib、RBAC保持基线；不合并审批链|e2e02/03及manifest负例|
|多品牌权限|角色定义未改；增强派工隔离|H01 9、H02 6、双重身份51|
|Provider管理|provideradmin与settings通道未改|provideradmin70|
|API预算与调用账本|providerlog、egress未改；既有缺陷保留登记|provideradmin70；不是预算绝对安全认证|
|视频工作区|后端video适配与路由未改，前端只补手工脚本缓冲|provideradmin70、浏览器135|
|企业资料库消费者|共享契约、签名、票据和eventconsumer未改|workspace离线36、dual51；无真实联调|
|已有审计记录|原业务库及密钥/配置9个备份文件哈希一致|protection-and-capability-integrity.json|

无整目录覆盖，无依赖、第三方部署或正式契约变更；没有删除既有业务API。锁定接口增加可选rowVersion属于运营侧本地并发校验，旧客户端调用路径仍保留。

## 回归限制

保留V0.1.6“已有有效功能”不等于补齐当时尚未实现的真实图生图、向量知识服务、社媒自动发布和生产运行保障。880项为本地合同夹具及浏览器测试，不代表外部服务验收。

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

