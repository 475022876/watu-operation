# 第一阶段安全修复说明

日期：2026年10月27日。分支：`baseline/consolidation-phase1`。

功能基线：`3d738981eb484a96b2a80d57608496800eacfa29`；修复参照：`1f0f1f04d4a3cd73cc21d57d7d6fdbcc6e258f49`。最终代码与测试工具提交：`6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`；报告归档提交另见本分支后续 docs 提交。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase1/VFIB-Marketing-OS`。原工作树及业务数据未更改，应用仍0.1.6、schema8；未合并、迁移、部署或发布。

## H01 派工幂等隔离

原缺陷：全局查找相同key后直接返回首次dispatch，未绑定当前请求范围。来源：独立整改1f0f1f0的dispatchDigest和冲突检查。

实际变更：对当前请求先进行品牌和editorial.approve鉴权，再比较actor、brand、proposal和规范化payload摘要。规范化仅包含实际消费的字段，并统一枚举大小写、默认值和对象键排序；其他actor、品牌、主题或变更内容均409 IDEMPOTENCY_CONFLICT。缺摘要的历史记录不猜测补全。修改范围为approve-and-schedule派工接口，没有宣布全系统幂等完成。

测试：T01 9/9，包括有效重放零新增、默认值等价、改payload、跨actor/brand/proposal、撤权、未授权404及历史摘要缺失。真实HTTP还覆盖409与零重复任务。

## H02 负责人制作权限

原缺陷：仅检查active账号。来源：参照分支principalOf及content.edit检查。

实际变更：提交时根据当前user_roles重新计算目标员工对任务品牌的制作权限；停用、失去权限、其他品牌和仅发布角色均拒绝，不产生Topic/Task半成品。未修改角色权限定义。

测试：T02 6/6。初始测试误将本就有content.edit的P1作为“无制作权限”夹具，出现一次测试失败；a73c37a改为P3后通过，没有收紧或削弱P1权限来让测试通过。

## H03 有限范围的提交与回滚

原缺陷：关键操作先改内存再延迟save，可能返回虚假成功；保存失败没有事务回滚。来源：参照分支atomicMutation，增加同步/嵌套约束和dirty状态恢复。

实际变更：明确五个操作使用同步快照提交：批准入池、批准派工、草稿创建、草稿更新、送审锁定。写入和rename成功后才能返回；异常恢复根数据库对象内容、业务集合、状态、审计和序号，再向上传递错误。禁止异步回调和嵌套事务。原生产损坏恢复load及旧saveNow语义没有修改。

测试：16项事务/版本测试及5项真实HTTP测试通过。注入write和rename故障，验证HTTP500、原库未半更新、恢复后重试仅创建一次任务。T07验证manifest及锁定rowVersion，不代替全部审核业务验收。

## H07 草稿失败保护

原缺陷：saveVersion捕错后仍返回隐式成功路径，调用方继续lock；重绘可能丢掉输入。来源：参照分支正文/视频脚本缓冲及保存失败返回false，额外处理保存期间继续编辑和重复点击。

实际变更：任何409、500或断网失败保留内存与当前控件文本，显示alert错误，阻止后续lock；包含VERSION_IMMUTABLE错误，不自动reload覆盖输入。提交前保存，确认后再次检查，锁定携带当前rowVersion。保存后刷新期间仍保留缓冲，并拒绝刷新中新增编辑的送审。视频手工脚本跨页签缓冲，未修改基线AI视频渲染功能。

测试：组件10/10、真实Chrome5/5。浏览器核验错误后可见文本、0次lock、服务端仍DRAFT且原正文未变，切页签保稿，取消故障后保存新稿。截图经过实际查看；首次测试脚本曾仅访问隐藏shell，已通过完整页面导航、可见性断言及截图帧等待纠正，旧截图不作为验收依据。

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

