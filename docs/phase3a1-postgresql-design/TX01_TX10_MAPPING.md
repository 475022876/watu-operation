# TX01—TX10设计对应表

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
