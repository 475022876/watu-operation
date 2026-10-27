# Phase 2 存储与剩余事务风险登记

日期：2026-10-27。分支：`baseline/consolidation-phase2`。业务修复最终提交：`e21da0a`；最后专项测试提交：`bf27962`；报告和原始证据为本分支后续归档提交。

功能主干为 `3d738981eb484a96b2a80d57608496800eacfa29`；第一阶段代码为 `6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`，报告归档与完整回滚点为 `319c5b3f357a8bfc077554e0f95b8ff00c3798df`。已核实提交祖先关系、原树及第一阶段工作树 clean 后创建独立第二阶段工作树。应用保持 **0.1.6 / schema8**。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase2/VFIB-Marketing-OS`。所有数据实验使用操作系统临时目录中的合成数据；未读取配置用于真实模型调用，未更改生产数据、密钥、Enterprise Workspace、双系统正式契约或历史分支。未部署、发布、推送 GitHub 或进入第三阶段。

命令中的 `$node` 指 `C:/Users/three/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`（v24.19.0），从上述工作树执行。JSON、原始日志及截图均在 `TEST_EVIDENCE_PHASE2/`。

## 已覆盖与审计方法

第一阶段同步事务仅覆盖editorial两条派工/入池写路径及content新建、编辑、锁定三条路径；本阶段H06只调整加载/阻断，不扩大事务覆盖。使用rg列举save/saveNow/atomicMutation，再读取审核联动、发布与入库关键逻辑。原始位置及静态计数见write-paths.txt、other-write-paths.txt、write-counts.json。静态命中数含辅助调用/分支，不能直接当作独立API数量。

## 后续整改清单（本阶段只审计，不执行）

|编号/级别|代码位置|失败风险|独立后续方案及验收|
|---|---|---|---|
|TX01 High|routes/reviews.js:278、442|审核决定同时变更审核单、内容、任务/入库状态后异步save，可能提前成功；入库分支有await|独立设计本地提交事务和远程授权分段状态；磁盘失败不得成功，绑定manifest/内容版本，重试无重复决定|
|TX02 High|routes/content.js:438|revise增加新版本、废弃旧版本、关闭审核单、任务退回制作后异步save|在独立方案中覆盖完整同步变更，验证失败恢复新旧版本与审批单一致|
|TX03 High|routes/publishing.js:186、262、401、535、581|排期、发布登记、纠错与回执状态/内容联动提前返回；未来外部发布有不可逆副作用|本地原子提交+outbox/幂等发布及补偿状态；先批准独立方案，禁止把社媒副作用包进同步事务|
|TX04 High|routes/admissions.js:280至949|入库申请、审核、远程三步交付及本地引用落库不构成跨系统事务|持久作业/outbox、稳定幂等键、远程回执重查；验证远程成功本地保存失败不重复入库|
|TX05 High|provideradmin.js:574、625、707、733；providerlog.js:74、188|配置、预算策略、调用账本使用save，成功回执与持久化不同步，失败重启可丢成本/限额状态|独立持久预算预留/调用状态机，调用前后结算和重试幂等；不得直接将await网络放入atomicMutation|
|TX06 High|routes/admin.js:66；eventconsumer.js:97至339|权限更新、票据/撤权事件/游标异步保存，重启可能恢复旧状态|先确认durable撤权与游标确认顺序；实时权威核验保留；故障/重启负例|
|TX07 High|routes/research.js:113至447；routes/video.js:254至321；routes/creative.js:526至652|队列/生成作业、账本、文件写入跨await，崩溃可能遗失任务或重复计费|独立作业状态机、幂等供应商提交、结果对账及素材校验，不在本阶段大改|
|TX08 Medium|routes/sources.js；campaigns.js；plans.js；topics.js；tasks.js；channels.js；studio.js|普通业务变更大多save防抖返回，磁盘失败存在虚假成功窗口|按影响逐路径补充持久化确认和rowVersion，先测试再逐项移植|
|TX09 High|store.js:202、446、451|单JSON进程间无锁；saveNow吞错；多个实例可互相覆盖；rename不等于fsync断电耐久性|部署先限制单写者；另行设计真实数据库/锁及迁移方案，未经授权不得迁移；磁盘满/断电/双进程试验|
|TX10 Medium|工作素材文件/数据库引用、uploads|文件和JSON之间没有跨资源事务，可能有孤儿文件或缺失引用|内容哈希、暂存/提交清单、幂等补偿与离线对账，禁止自动删除生产素材|
|OP01 Medium|H06恢复流程|安全阻断改善数据保护，但故障时需人工恢复，不能自动空库继续营业|告警、停写、一致性备份、隔离认证解密/校验、人工批准切换；DPAPI账户需独立灾备方案|

以上分类是静态风险识别，并未宣称逐条注入生产故障。H03剩余项仍未修复，也未进行数据库迁移。旧代码注释中“单进程天然串行/崩溃全部未发生”不能替代跨await、异步save或跨文件事务证据。

## H06恢复操作说明

1. 数据库读取失败即停止实例；保留原mos.json、目录、日志及校验摘要，不改名播种，不直接在原路径试错。
2. 确认人工恢复授权、备份时点、配置/素材/密钥配套及Windows DPAPI账户恢复能力，备份当前损坏文件用于调查。
3. 在隔离目录认证解密经批准备份，核对每项SHA256、JSON/schema8、关联对象/素材、权限与版本。认证失败、缺项、未来schema或不一致时停止，不回退成空库。
4. 隔离验证应用启动与关键业务状态；准备同一时点回滚副本；由人工批准停写后的切换。本阶段没有执行该生产步骤。
5. 只回退代码时也必须使用经验证的健康数据。第一阶段加载器仍有旧自动播种行为，绝不能让回滚代码打开损坏库。

## 可复核命令与结果

```powershell
rg -n 'save\(|saveNow\(|atomicMutation' lib/mos/routes -g '*.js'
& $node tools/phase2/storage-test.js     # 7/7
& $node tools/phase2/rollback-test.js    # 健康schema8合成副本加载通过
& ./tools/phase2/verify-existing-backup.ps1  # 9项加密备份重新认证/摘要通过
```

关联提交d14b6ab、ba8d935；最终代码e21da0a。备份摘要`01e85b57c57e786398443140a84a19ac0ba9768f54ef93d00425f2a92c20b596`，位置`D:/运营系统/VFIB-Marketing-OS-Phase1-Evidence-20261027/original-consistent-backup.aesgcm.json`，不包含在审阅源码包中。只有同Windows用户/profile的内存解密被验证；没有证明异地或跨账户恢复。

## 验证分层及共同限制

- 本地模拟/组件：H04 安全 13/13，H05 策略 22/22、真实适配器入口负例 3/3，H06 加载/恢复 7/7，M05 组件 6/6。
- 隔离服务集成：原有 17 套回归 880/880；第一阶段保护回归 57/57（其中真实 Chrome 草稿流程 5 项）。第二阶段真实 Chrome 品牌切换 2/2。第二阶段专项合计 53/53；加上上述回归共 990 个断言/用例通过，不代表 990 个独立业务场景。
- 真实外部服务：**NOT VERIFIED / BLOCKED**，未调用真实模型、搜索、企业资料库服务或社媒服务。Workspace 策略测试替身、HTTP 本地桩、TLS 请求参数替身均明确区分，不能作为真实供应商验收。
- 生产验收：**未执行，待人工审核**。仍有异步持久化及跨文件/跨服务一致性风险，见存储风险清单。备份依赖当前 Windows 用户的 DPAPI；不能证明跨机器灾备。
