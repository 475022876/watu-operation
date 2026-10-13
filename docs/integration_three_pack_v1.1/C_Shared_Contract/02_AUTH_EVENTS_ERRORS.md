# 服务身份、用户票据、事件与错误协议
## 双重身份
- Provider接收服务账户Ed25519请求签名，校验时间戳、nonce、防重放、权限范围和身份状态。
- 请求携带受限用户票据，Provider在服务端复核该用户真实存在、启用、品牌/密级/对象权限。**服务身份不能自动代表最终批准身份。**
- 不允许明文交接私钥、会话Token、真实管理员账号。仅交付公钥、环境变量名称和脱敏示例；生产必须轮换密钥。
## 消费方票据管理
- 明确签发、过期、刷新、撤销、并发刷新、401/403回退、重新身份校验路径。
- 跨主机必须TLS证书校验；本机回环仅隔离测试允许HTTP；禁止关闭TLS验证。
## 变更事件
- Consumer差异文档列7个事件字面量：`service_account.changed`、`skill.version.changed`、`policy.version.changed`、`admission.state.changed`、`asset.revoked`、`asset.deprecated`、`permission.changed`；最终以Provider枚举确认。
- `changes`游标单调seq；事件队列当前说明保留上限5000、响应可能`truncated:true`、建议60秒轮询。
- Consumer必须持久化游标、幂等事件处理、重启续传；`truncated`/游标落后、签名错误、长时网络中断须触发权限重新确认与全量重建，不静默沿用失效缓存。
- 60秒仅是建议轮询间隔，不是已验收的撤回时延SLA。关键新调用要重新验证权限；故障时fail closed。
## 错误处理
- `BAD_ADMISSION_INPUT`、`USER_NOT_FOUND`及Provider响应中的其余错误码按实际契约建立白名单处理；未知错误不能静默成功。
- 400字段错误→提示修正、不盲重试；401/403→票据刷新/重新授权且有次数限制；408/429/5xx或网络中断→有界退避重试，原幂等键不变；无法确定提交结果→先查询状态，不能直接生成新的申请。
- 错误日志必须脱敏，不保存私钥、令牌、客户敏感信息。
