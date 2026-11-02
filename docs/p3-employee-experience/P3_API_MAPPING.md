# 既有 API 与新交互

不新增业务 API、不另建任务库、不改变 Workspace 正式契约。

| 员工动作 | 既有 API | 约束 |
| --- | --- | --- |
| 登录 / 当前身份 | `/auth/me`、`/auth/login`（均在 `/api/mos` 下） | HttpOnly 会话与 CSRF；无 Bearer Token、演示角色或口令缓存 |
| 我的任务 | `GET /tasks?brand=…` | 完整分页；按当前用户筛选；品牌来自服务端可见品牌 |
| 新建任务 | `GET /task-workspace/people`、`POST /tasks` | 负责人列表为当前品牌实际可制作人员；复用任务字段默认值 |
| 任务要求、资料、历史意见 | `GET /tasks/:id`、`GET /tasks/:id/workspace` | 同品牌身份验证；不把关联文件当作模型已理解 |
| 保存当前作品 | `POST /content-versions`、`PUT /content-versions/:id` | PUT 带 rowVersion；保存结果对应捕获的正文/附件，不把保存中的新输入当已保存 |
| 上传 / 绑定附件 | `POST /assets/upload`、版本 PUT `refAssetIds` | 沿用扩展名、魔数、权限与大小校验；文件未作为模型输入 |
| 候选文字 | `POST /generation-jobs` | 复用 Provider / 预算 / 账本 / 外发检查，限定当前试点为 Mock，TEST_DRAFT；不直接 applyToVersionId |
| 冻结送审 | `POST /content-versions/:id/lock` | 先确认当前保存版本，再传 rowVersion；不提交讨论；未知结果不重放 |
| 审核作品 | `GET /review-cases`、`GET /review-cases/:id` | 使用 canDecide、allowedActions 及服务端 manifestMatches |
| 退回 / 批准 | `POST /review-cases/:id/decision` | 服务端禁止自审、检查冻结对象和专业审核顺序；带 rowVersion |
| 修订 | `POST /content-versions/:id/revise` | 新版本保留旧意见；旧审批不继承；带 rowVersion |

## 确认的适配差异

1. 既有创建版本接口不接受附件字段：第一步建立正文版本，选定附件保留在本地并标为未保存，第二次保存通过既有 PUT 绑定；绑定前不能送审。不以两次请求冒充原子事务。
2. 创建版本、修订没有请求关联查询接口：未知结果持久标记在当前账号/品牌/任务本标签页缓存中，不自动重发。使用者查看服务器作品后明确采用；服务器无作品或无法唯一判断时停止并要求管理员核对，不伪称有服务端幂等能力。
3. 审核和修订增加**已有 rowVersion 字段的可选校验**：旧客户端不传仍兼容，试点客户端传入则拒绝过期版本。未更改 API 路径、响应结构或 Workspace 契约；该增量行为需在审查时关注。
4. 专业审核和发布审批分开执行，已批准不意味着排期、社媒发布或企业资料库正式入库。

## 资料与持久化边界

任务、正文、附件及审核权威仍为现有 JSON；本标签页缓存只辅助草稿恢复，不是第二业务库。缓存键包括 actor / brand / task，恢复前核对基础版本；权限不明、基础版本不同或结果未知时不自动恢复。讨论未持久化，刷新后不保证恢复讨论内容。用户切换身份或窗口回到前台时重新验证会话；写入前再次核对身份与品牌，服务端仍是最终权限权威。
