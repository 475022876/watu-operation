# Phase 3A-2 Repository 与事务基础层

日期：2026-10-28；代码检查点 64195fb，最终代码见本分支后续提交。验证：`node tools/phase3a2/run-foundation.cjs`，实际 100/100。

## 组件与使用边界

| 文件 | 职责 |
|---|---|
| lib/mos/pg/database.js | 显式 opt-in、池、可信身份上下文、同连接 UoW、期限、提交/回滚、有限重试、日志 |
| lib/mos/pg/context.js | AsyncLocalStorage 与事务内外部操作断言 |
| lib/mos/pg/repository.js | 固定标识符、参数化值、品牌注入、DTO 映射、乐观锁 |
| lib/mos/pg/errors.js | SQLSTATE 到稳定安全错误映射 |
| tools/phase3a2/database.cjs | 仅隔离测试账号、初始化、合成种子、Migration |

当前 factory 只接受显式 loopback、`mos_phase3a2_*` 库、mos_app/mos_worker 角色及完整凭据，不能误用生产 DATABASE_URL。连接失败直接 PG_UNAVAILABLE，不回落 JSON。池是服务级对象，不应每个请求创建；关闭时清零内存签名 key、结束池。

服务端必须安装可信身份 resolver；请求参数不能自行指定 actor/roles。contextFor 产生不可伪造对象；数据库还验证签名及当前用户 active、品牌授权和权限，撤权后旧上下文不继续放行。

Repository 已实现 content_tasks / content_versions 的基础 CRUD 和 CAS 示例，固定字段白名单，JSONB 显式编码。不宣称已迁移 74 张表全部业务 Repository。原有业务路由、审核状态机、Workspace 正式消费者接口仍走原代码。

## UoW 与失败语义

一次 transaction 从池取一条连接，BEGIN、上下文、业务 SQL、COMMIT 或 ROLLBACK 都在同一连接。禁止嵌套。默认 statement 3s、lock 1s、总事务 5s，最大总期限 15s；查询/连接也有限时。释放前 RESET ALL 并校验上下文清空，异常连接销毁。池上限可设 1—10。

CAS 更新 version 不匹配返回冲突；唯一、外键、非法状态、权限、不可变记录、超时均映射安全错误，不暴露 SQL、参数、密钥或资料正文。日志仅事件、稳定 code、attempt、上下文清理标记。

仅调用者明确 retrySafe 的死锁/序列化失败可有限重试（至多 3 次）。提交期间断连或总期限到达返回 PG_COMMIT_OUTCOME_UNKNOWN，禁止自动重试，后续业务需用幂等键查询结果。该语义不能虚构为“肯定未提交”。

外部 AI/Workspace/文件网络操作不得放入数据库事务；提供 outsideTransaction/assert 供后续服务使用，并有总期限兜底。它不是对任意 Node fs/http 调用的全局拦截器；本阶段没有把原外部调用搬入事务。长任务今后用 Outbox/幂等 worker，尚未接线。

## 回滚与待办

没有业务存储接入点，停止隔离测试即可恢复原运行形态；不要删除 JSON。后续需另行批准：真实认证适配、签名 key 轮换、远程 TLS 配置、完整领域 Repository、幂等/Outbox 消费与结果确认。这里不启用生产连接，也不执行自动降级或双写。
