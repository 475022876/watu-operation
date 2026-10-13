# 运营中台整改任务
**B0** 核对最新git commit、已有`MARKETING_HANDOFF_BUNDLE`与Provider实际OpenAPI hash；按C包冲突规则形成逐条Diff并经Provider确认。

**B1（P0）准入表单与实体。** `libraryPrimaryCategory`、`classification`、`licenseStatus`必须在提交申请UI、后台领域对象、持久化、校验和接口映射中完整存在；枚举来自提供方签署口径。历史自由文本许可未映射时显示需人工核定/unknown，不可视作cleared；密级不得猜测降级。`reviews[]`严格使用Provider schema，真实审核人，不伪造通过。补充幂等提交/重试/失败查询。

**B2（P0）双重身份。** 实现Ed25519服务签名及带真实用户范围票据调用，支持过期刷新、吊销、并发与重放拒绝、401/403处理；Provider端角色始终是权威；从不保存用户凭据/服务私钥于浏览器或日志。

**B3（P0）事件消费。** 实现独立轮询作业、持久化seq游标、断线重试、事件幂等、按品牌处理、`truncated:true`全量重验、技能版本变更和资产撤回/停用/权限变更缓存失效。新创作使用/下载必须重新验证授权，Provider不可用时fail closed；不得仅按60s轮询推定权限仍有效。

**B4（P0）全链路集成。** 正式资料检索/Approved资产检索、Skill当前版本读取、正式资产申请（人工专业审核+用户最终批准）、成功入库assetId/version、失败补偿、正式使用、撤回失效；全部通过真实独立HTTP服务验证。禁止Mock冒充正式入库。

**B5（P0）Published Content隔离。** 针对LinkedIn/YouTube等完成内容审核、手工发布、真实PublicationRecord/快照；查Provider资料库未被自动镜像。提取复用母版必须是独立准入请求。

**B6（P1）专业字典。** 用实际SPECIAL-01正式原件与Skill V1.2逐项校对C01-C06、N01-N05、V01-V05、F01-F04、M01-M05、A01-A08、G0-G3；未确认继续UNVERIFIED。所有新内容保留品牌规则版本/Skill hash。

**B7（P1）真实AI。** 在企业外发策略许可下测试一个真实文字Provider与一个真实图片Provider（用户需配置有效凭据）；留存供应商模型ID、prompt、技能版本、成本、审计记录；无凭据=BLOCKED。禁止向模型直接发送全库或敏感KYC。

**B8（P1）可用性与安全。** 用真实浏览器分别跑P1-P4任务流程，包含否决/超时/网络故障；全量测试、SSRF/CSRF、密钥扫描、备份回滚；不额外建立CRM/S05模块。
