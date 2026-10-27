# 第一阶段备份与回滚

日期：2026年10月27日。分支：`baseline/consolidation-phase1`。

功能基线：`3d738981eb484a96b2a80d57608496800eacfa29`；修复参照：`1f0f1f04d4a3cd73cc21d57d7d6fdbcc6e258f49`。最终代码与测试工具提交：`6db3c0d1d1a80543c22138e3d4d4a89fd0b698d2`；报告归档提交另见本分支后续 docs 提交。

工作树：`C:/Users/three/.codex/worktrees/baseline-consolidation-phase1/VFIB-Marketing-OS`。原工作树及业务数据未更改，应用仍0.1.6、schema8；未合并、迁移、部署或发布。

## 备份闸门与原树保护

修改代码前已核实原树main为指定提交且clean。参照树有此前测试JSON和交付物的未提交变动，但业务源码无未保存修改，全部保留；未对参照树执行restore或测试。

原数据位置：`D:/运营系统/VFIB-Marketing-OS/data/mos.json`。配置：根目录config.json；素材和发布快照位于data/uploads及其子目录；本机主密钥引用为data/.mos-secret.key。当前未配置外部签名私钥路径、内嵌签名私钥及MOS密钥环境变量；未输出任何明文。

未发现原应用server.js进程及9080/9083监听。备份前后再次核对所有受保护文件哈希，验证没有并发写入。确认后才创建独立工作树和分支，没有切换或覆盖原main工作树。

## 加密备份与恢复验证

备份位置：`D:/运营系统/VFIB-Marketing-OS-Phase1-Evidence-20261027/original-consistent-backup.aesgcm.json`。

SHA256：`01e85b57c57e786398443140a84a19ac0ba9768f54ef93d00425f2a92c20b596`。

共保护9个文件，包含数据库、配置、素材和密钥文件。整个ZIP只在内存形成，AES256GCM加密后落盘；备份数据密钥通过Windows DPAPI CurrentUser保护。没有将主密钥明文复制到交付目录。文件清单、长度与校验摘要见backup-verification.json，源代码和状态摘要见外部目录original-before.json。

恢复验证从已落盘密文重新读取、DPAPI解封并认证解密，在内存逐个核对所有条目SHA256并解析mos.json；源文件再次哈希一致。恢复条件已确认：必须保留同一Windows账户及其DPAPI配置文件。本备份不是跨机器、无账户恢复的灾备证明。没有在本轮向生产路径恢复任何文件。

## 代码回滚点

|修复|应用提交|该修复前点|
|---|---|---|
|H01|107134c|3d73898|
|H02|373cf1b、a73c37a|107134c|
|H03|61a874a|a73c37a|
|H07|f8aae00及6db3c0d|61a874a|
|测试与工具|552115e|f8aae00|

上述为独立可审阅提交，不是自动回滚指令。H02包含测试夹具更正。后续补丁有依赖，不能在保留依赖方时盲目revert事务辅助；需在独立回滚分支验证。原main仍为3d73898，可继续使用原功能树，本轮未要求替换正在使用的系统。

## 人工回滚步骤

1. 停止候选实例接收新写入，确认在途作业和外部副作用。本轮没有真实外部生成或发布。
2. 若仅撤回本候选，不需要修改原树或生产数据；保留本分支以便复核，不删除历史。
3. 若未来经授权投入候选后需要恢复，先备份当时状态，再用原代码提交及同一时点数据、配置、密钥和素材恢复到隔离目录验证。
4. 使用同Windows账户读取加密备份，认证解密并核对全部条目，不在终端打印密钥；路径校验确保不会越出指定恢复目录。
5. 隔离验证JSON、schema8、素材哈希和权限后，由人工批准切换；不要改schema版本或删除集合模拟降级。

外部目录create_verified_backup.ps1为备份及内存恢复校验脚本。重新执行会重新生成备份，故本次原始密文应先保留；不应将重新运行脚本当作回滚操作。本轮数据损坏实验仅对临时副本，生产load恢复策略未改。

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

