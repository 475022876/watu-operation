# Phase 3A-2 RLS 与安全边界

日期：2026-10-28。基线 bbd3658；实现 64195fb 及本分支后续提交。命令：`node tools/phase3a2/run-foundation.cjs`，安全子组 **45/45 PASS**。

## 信任模型

mos_owner / mos_guard 为 NOLOGIN；mos_app / mos_worker 非所有者、非 superuser、NOBYPASSRLS、无 CREATE/CREATEROLE/CREATEDB 权限。migrator 是独立初始化授权路径，不能作为普通应用身份使用。61 张业务范围表强制 RLS，其余全局身份/配置表采用撤销直接权限和专用函数，而不是一律开放。

SET LOCAL 的任意品牌字符串不足以授权。上下文由受信服务 HMAC 签名，绑定 actor、brand、backend PID、transaction ID、短期限。密钥仅在测试内存及受保护设置行，普通角色不可读取。数据库再次检查当前 active 用户、品牌授权、权限；RLS 不替代应用 RBAC/审核。

## 实际负例与正例

- VFIB / UCARD 相互读写拒绝；复合品牌外键阻止跨品牌关联。
- 缺少上下文、伪造 GUC、请求 actor、篡改签名、超期、跨连接/事务重放均拒绝。
- Pool max=1 重用同 backend，前次上下文被清空，不泄漏品牌。
- 撤权、禁用账号后旧 context 拒绝；worker 也受相同边界。
- 普通角色不能改 Schema/迁移登记，不能广泛读身份/Provider 密钥/撤权细节。
- 专用 current_identity 返回本人非敏感字段；Provider 配置仅有权用户可读且排除 secret 字段。
- 审计追加要求匹配当前 actor；普通角色不可任意读删审计，owner 也不能绕过不可变触发器修改历史记录。
- 作者不能自审批；有权独立审核/发布者正例通过，审批摘要与冻结版本绑定。
- 公开来源证据通过受控函数写入；直接伪造 report-evidence 关联、跨品牌来源引用拒绝。
- 已完成文件/hash/位置、冻结版本素材、终态入库与 MOCK/REAL 元数据不可被重写。

实际名称和逐项状态见 foundation.json，Schema/事务子组另列，不能重复统计。

## 剩余边界与回滚

签名服务及数据库管理员属于信任边界，若服务签名 key 或管理员权限失陷，不能靠 RLS 自动弥补。当前随机 key 只用于隔离测试；生产轮换、运维拆权、远程 TLS、真实身份适配未执行。签名上下文不能直接从客户端 API 接受。保留原应用 RBAC 和审批。

回滚：停止隔离基础设施，JSON 业务不受影响；不得移除 FORCE RLS、改用 owner 登录或默认放行来解决兼容问题。未进行生产验收或安全渗透全量认证。
