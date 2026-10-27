# PG03 事务、并发与权限设计

设计日期：2026-10-27。唯一分析基线：`7f05078614a789b94a040f67b18e462f2284f063`，分支 `baseline/consolidation-phase2`，仓库 `475022876/watu-operation`。开始时HEAD、origin远程分支及干净工作树一致。应用0.1.6、mosSchemaVersion=8保持不变。

本轮是 **Phase 3A-1设计**：没有导入应用store、启动业务服务、读取生产JSON内容、安装依赖/PostgreSQL、执行SQL、迁移数据或修改任何业务源码。Phase 2的990项记录是既有隔离证据，本轮只核对源码及证据，不将其说成PostgreSQL测试通过。SQL是待评审草案，未在数据库解析或执行；本轮静态检查不能代替下一阶段迁移/约束/RLS验收。

## Repository / Transaction Layer

保留路由、DTO、状态机、RBAC和Enterprise Workspace网关语义，改内部持久化边界：Controller→现有业务规则/聚合Service→Repository→同一PG client的UnitOfWork。事务上下文显式传给审计、幂等、预算和Outbox Repository；pure helpers可继续接收限定聚合的只读对象，不能在全局getDb里偷偷装一个全库缓存再回写。

当前getDb同步返回可变数组、atomicMutation拒绝async，而PG I/O必须await；30个直接消费者及其调用链需逐模块内部改造。不得将getDb简单改成Promise、用Proxy伪装数组或每次SELECT全库后全量DELETE/INSERT。未来runInTransaction(async tx=>...)需要begin/commit/rollback/finally release，每条SQL参数化，所有操作同一个client；不能在pool.query随机连接间拼事务。[node-postgres事务说明](https://node-postgres.com/features/transactions)。

默认READ COMMITTED+明确行锁/CAS/唯一约束；跨行谓词不适合锁固定行时可用SERIALIZABLE并处理40001，不能误认为隔离级别会自动防应用丢写。[PostgreSQL隔离级别](https://www.postgresql.org/docs/18/transaction-iso.html)。

## TX01—TX10全覆盖

|风险|领域|数据库事务边界|外部与补偿边界|验收负例|
|---|---|---|---|---|
|TX01|审核决定/内容联动|锁actor+case+主体版本/任务；重查职责分离和manifest；decision追加、case与内容/任务状态、审计一次提交|远程准入授权在事务外取得证据，短事务重查授权epoch/冻结主体后提交；失败不记批准|并发相反决策仅一个成功；断连接/磁盘满/撤权后无部分成功|
|TX02|内容修订/旧审核失效|锁task+old_version+所有未终结case；分配新number；新草稿/旧SUPERSEDED/取消decision/任务状态同提交|无需网络；冻结文件检查先做并在事务中核对file_version/hash|同时修订/编辑/批准不会复用旧批准；409保留员工草稿|
|TX03|排期/发布/回执|排期更新CAS；版本、渠道、审核、READY素材再校验；发布记录+不可变文件引用+审计一次提交|现有人工登记不发社媒请求；未来发布用Outbox和外部幂等回执/补偿，文件准备在事务外|保存失败不得伪造PUBLISHED；回执重复/乱序不倒退状态，快照完整|
|TX04|企业资料准入|准入本地审核状态、独立finalApprovalStatus/syncStatus、作业及outbox同提交；稳定origin/idempotency|worker按create→submit→artifact执行现有正式契约；外部成功本地失败先查回执再恢复；不可回滚已获批准的远端事实|远程超时/429/回执丢失/本地提交失败均不重复入库，不凭MOCK得到真实复用资格|
|TX05|Provider预算/账本|锁预算period行；原子检查confirmed+reserved+unknown与限额；插唯一invocation预留+job/outbox；结算账本+预留+审计同提交|模型调用在事务外；实际供应商费用与估价分离；超时结果UNKNOWN保留占额，不自动释放或双记|并发抢最后预算不超配；同回执只结一次；重启未知费用不当0|
|TX06|权限/撤权/游标|所有授权更改先锁user，增加authz_epoch；inbox去重+失效登记+票据元数据过期+游标同提交|外部事件轮询在事务外；未知事件/truncated置reconcile_required并暂停关键使用；以Workspace实时授权为准|游标不能越过未提交撤权；旧会话/在途本地权限快照不能绕过；全局失效不缩成某品牌|
|TX07|研究/图片/视频作业|创建job+幂等记录+预算预留+outbox；短租约领取；完成时用lease_token/CAS写结果、素材、账本与审计|search/LLM/render/poll/download均事务外；不支持供应商幂等的模糊结果先对账/人工处理|worker崩溃/租约过期/晚回包无重复采用；拒绝将未真正调用写SUCCEEDED|
|TX08|常规计划/活动/任务等并发|单聚合显式Repository UPDATE ... WHERE row_version=expected；关联FK/唯一+审计同事务|大查询分页/确定排序；日历仍同源投影，不另建一套日历事实|多员工同版本并发一个成功另一个409；非法跨品牌FK前仍做RBAC|
|TX09|存储耐久/多进程|PG WAL durable COMMIT；同client事务，明确异常回滚；唯一业务编号用锁计数器；禁整库覆盖|业务实例全部切到一个权威PG；PG故障Fail Closed，不自动退JSON；备份/PITR处理灾难|双实例并发、断连提交不确定、死锁/序列化重试、重启与恢复验证|
|TX10|文件/数据库一致性|PG保存上传状态/固定文件版本/哈希和引用；只有已校验READY可引用；关系提交与业务状态一致|文件暂存→校验→READY短事务；Outbox对账+隔离孤儿+人工删除；不承诺跨存储原子性|各崩溃点无可发布的缺文件引用；文件哈希/PITR时点可对账，无擅删素材|

## 锁顺序和并发编辑

所有写事务固定按用户id排序锁当前actor/负责人授权行，再锁聚合根（任务/准入/报告），再锁内容版本、case等从属行，最后预算/幂等/审计记录；混合预算与任务服务须共用已评审锁序，避免某路径倒序。预算锁前置预检可在单独短事务预留，避免与聚合长链交叉锁。角色撤销必须也先锁用户行并增加epoch，不允许只删grant绕过同步点。行锁/死锁处理依据[PG锁机制](https://www.postgresql.org/docs/18/explicit-locking.html)。

负责人只Active不够，派工提交前仍查询当前品牌content.edit权限。锁用户授权行后关键操作与撤权有可定义提交顺序；不要依赖session缓存角色、Redis或启动时权限快照。RLS校验品牌可见性，Service RBAC校验动作与职责分离，二者都必须执行。

编辑草案示意（仅文档，不执行）：

```sql
UPDATE mos.content_versions
SET body=$1, row_version=row_version+1, updated_at=CURRENT_TIMESTAMP
WHERE brand_code=$2 AND id=$3 AND row_version=$4 AND state='DRAFT'
RETURNING id,row_version;
```

0行先按同品牌授权查询区分既有404/状态错误/ROW_VERSION_CONFLICT；不要统一泄露外品牌是否存在。CAS失败事务回滚，H07仍保留当前草稿，不能继续锁旧内容。版本number在task行锁内分配并受唯一约束，不用并发MAX+1裸写。所有跨对象引用先应用鉴权，再依赖复合FK兜底。

## 幂等、提交不确定与错误映射

H01标准化仍调用原JS算法；幂等唯一(actor,brand,operation,resource/proposal,key)，digest保存normalized payload。单事务争抢唯一键，同key不同digest返回原明确409；相同digest返回首次持久化response_snapshot，不能根据已变化任务重建另一份结果。实际payload/快照不写密钥，响应不得包含未经授权品牌数据。

COMMIT已发送但连接断开属于UNKNOWN，不等于回滚；用相同幂等作用域在新连接确认提交状态后返回/重试，不产生第二业务编号、审批、外部提交。40001/40P01仅在事务内无外部副作用且幂等允许时有界重试（初拟最多3次+抖动），业务409不自动重放覆盖编辑。

DB23505/23503/23514通过具体Repository上下文映射既有API错误码和状态；SQL/表名/连接串/堆栈不得回传。超时/数据库不可用走现有失败结构，绝不初始化新库或自动读旧JSON掩盖失败。短事务初拟statement_timeout=5秒、lock_timeout=1秒、idle_in_transaction_session_timeout=10秒，须按回归/压测修订，不是已验证生产参数。

## Outbox / Inbox执行协议

1. 事务A：授权、不可变请求快照、幂等、预算预留、业务job及Outbox一起提交；拿到提交成功后才允许启动worker。
2. 事务B：worker用FOR UPDATE SKIP LOCKED领取到期任务，设置lease_owner、lease_until、递增lease_token，立即提交。SKIP LOCKED仅用于队列，不用于普通业务读以避免遗漏，[官方SELECT语法](https://www.postgresql.org/docs/18/sql-select.html)。
3. 无数据库事务持有期间执行外部搜索/模型/资料库API/文件I/O；发送前重新验证用户/品牌权限、Workspace授权和H04出站安全；租约心跳只用独立短事务。
4. 事务C：只有正确lease_token/幂等身份才能接受回执，追加调用事实，结算预算，落素材及业务状态，写审计并完成Outbox。失去租约的迟到worker不能覆盖新结果。
5. 对方支持幂等时复用稳定外部key；不支持时，发送超时进入UNKNOWN/RECONCILIATION，不盲目再次计费或发布。at-least-once投递不等于跨系统exactly-once，不能作此承诺。
6. Inbox对provider+brand+stream+event_key去重；撤权、缓存失效、游标、审计同提交。事件缺失/截断须全量对账；已有processSeqs仅导入去重事实，不把历史元数据当新事件重放。

## 预算、冻结和远程授权特别说明

预算period同时核算confirmed、reserved、未知结果占额，NULL仍未知；旧账本滚动丢失部分需财务/预算责任人批准期初余额，不能置零。provideradmin与research-engine费用口径要先决策再统一，不以数据库替换暗改预算含义。

内容冻结后正文、引用、披露、渠道和语言由不可变版本/manifest绑定，state可按原状态机流转；审核决定记录固定hash及policy_version。素材替换必须新file_version/新内容版本；允许修改负责人等非实质字段不能改变冻结摘要。审批发起人不能审批自身内容。

Workspace实时授权发生在外部调用阶段，不能在数据库长事务里等资料库响应；取得权威证据后本地重查epoch、失效登记、主体hash。外部系统在最后校验后立即撤权与已经发出的网络请求之间仍有不可消除窗口，应使用现有短期用户票据、记录授权时点并停止后续下载/复用；数据库RLS不能消灭这一跨系统事实，也不能替代H05外发检查。

## 同步API兼容

已有同步模型接口可保持HTTP请求等待，内部等待worker/结果时不持DB事务；超时返回原失败结构并按原幂等查询首次结果，不能擅自改成202或新状态。已有异步研究/视频接口继续原jobId与轮询契约。若具体同步端点无法在旧超时/响应字段内安全表达UNKNOWN，列为协议变更申请阻断该端点迁移，不以“API零修改”掩盖冲突。
