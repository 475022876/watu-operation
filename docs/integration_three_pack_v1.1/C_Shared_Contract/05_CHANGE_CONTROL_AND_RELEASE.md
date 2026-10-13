# 接口变更与版本治理
- Provider拥有接口定义修改权；Consumer可提案但不得自行修改权威契约。
- OpenAPI基线原文件只读；必要变更提交 `CCR-YYYY-NNN`，附动因、字段前后对照、兼容性、迁移、灰度及回滚、两侧测试；确认后另存带新版本号的契约文件。
- 严格区分：文件包V1.1、应用版本（OA报告V1.1.7 / MOS 0.1.0）、API当前实施版本（报告1.0）、Git commit和环境。
- 发布登记字段：system, repo, appVersion, gitCommit, contractVersion, openapiSha256, environment, buildTime, integrationStatus, acceptanceStatus, rollbackRef, owner。
- 双项目只修改各自仓库；共享契约建议由用户统一下发和收取对照签署稿，非第三业务系统。
- 输出必须包含可复现命令、测试夹具哈希、脱敏日志、无法完成的环境依赖；禁止部署生产或使用真实客户资料试验。
