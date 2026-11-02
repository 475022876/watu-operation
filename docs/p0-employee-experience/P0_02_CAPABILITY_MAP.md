# P0-02 当前能力、流程和接口映射

日期：2026-11-02。仅静态核对；实现和历史测试不等于本轮真实服务验收。

| 场景 | 当前源文件/接口 | 已有能力 | 新界面要改变什么 |
|---|---|---|---|
| 个人待办 | modules/workspace.js；GET /api/mos/my-work | 负责的任务、草稿计划、待审核、本周排期 | 以待我处理/待修改为主，减少并列说明和统计卡片 |
| 任务检索 | modules/tasks.js、components/taskkit.js；GET /api/mos/tasks | 状态、workState、日期、品牌、分页及负责人 | 明确默认视图和下一步，保留高级筛选而非铺开全部字段 |
| 要求与分工 | routes/tasks.js、task-workflow.js；POST/PUT /api/mos/tasks | 要求、负责人授权、时间、版本冲突、原子持久化覆盖路径 | 简洁发起表单，技术分类不要求员工理解 |
| 任务上下文 | modules/task-detail.js；GET /api/mos/tasks/:id 和 /workspace | 作品、文件、要求、反馈聚合 | 同一工作表面持续使用，按角色突出下一步 |
| 对话创作 | modules/text-studio.js；POST /api/mos/generation-jobs | TEXT作业、Mock标识、输入保留、预算/外发检查入口 | 讨论区+当前作品；减少表单感，能力状态按需显示 |
| 选择结果交付 | components/text-handoff.js；POST tasks及content-versions | 选定正文保存，现有任务/新任务，失败提示 | 尽量保持任务上下文，避免重复选任务与手工搬运 |
| 作品持久化 | routes/content.js；POST/PUT /api/mos/content-versions | 作品版本、rowVersion、DRAFT可编辑、引用品牌检查 | 后台保留版本语义，界面突出保存状态与恢复 |
| 冻结送审 | POST /api/mos/content-versions/:id/lock | 持久化后冻结、manifest、G2/G3专业审核、发布批准 | 员工只确认本次作品/附件，不能直接改为聊天工具的批准 |
| 退回修订 | /revise；routes/reviews.js | 新修订与旧版本关系、审核历史、状态联动 | 在意见旁继续修改，不让作者寻找新版本入口 |
| 审核决定 | components/reviewkit.js；GET review-cases，POST /api/mos/review-cases/:id/decision | 服务端可执行动作、独立审核、版本校验 | 审核对象优先，技术hash等折叠；前端动作只用服务端能力 |
| 文件 | api.js、routes/creative.js；POST /api/mos/assets/upload，GET assets/:id/content | 原始文件上传、格式/魔数/体积与品牌校验 | 上传状态与可用性明确，不能把文件登记等同已理解 |
| 品牌/身份 | app.js、api.js、routes/auth.js、rbac.js | HttpOnly会话、CSRF、品牌及能力验证 | 同源接入，单一可信身份，切换时隔离缓存与草稿 |
| 错误/中英文 | i18n.js及词条 | 资源匹配、受保护正文、错误码映射 | 新组件显式key，不依赖中文模板反向匹配；人工验收 |

以上接口清单是适配方向，P3之前需要形成按字段/错误码/分页/能力的契约样例。不能根据URI一致就宣称兼容，也不在P0新增或修改接口。

## 数据权威和必须保留的功能

- Task、ContentVersion、ReviewCase/Decision继续由MOS负责；聊天只是创作过程。
- 权限由MOS与Workspace既有权威校验；新前端的role标签不产生权限。
- Provider/预算/账本、模型出站、资料密级、外发与撤权仍走既有检查。
- Master Topic、来源研究、内容/发布日历、活动、视频、正式入库、历史审计保留，不因三页试点删减。
- 当前JSON权威和PG未来路线不因换前端变更；P0不读取生产数据或配置。

## 已确认的结构差异与静态风险

1. 当前app.js以动态import及全局mounted/activeModule挂载模块；第三方组件需要Provider、路由与Store，不能直接替换一个loader就运行。
2. text-studio.js的sessions/inputs与task-detail.js的drafts是内存Map。现有输入恢复不等于服务端草稿或刷新后备份，需明确恢复范围。
3. text-handoff.js是“创建任务→创建作品”的两个HTTP请求，不是跨请求事务。已有部分成功提示，但重试/重复对象需P3独立方案。
4. task-detail已将作品置于主区，但复用reviewkit仍会展示技术审批详情；需要新交互适配而非复制旧弹窗。
5. 当前生成接口按作业响应，不能假定提供LibreChat式流式对话、工具事件、会话线程或中止协议。P2可模拟，P3必须按实际能力接入。
6. 当前文件上传/图像/视频接口能力有限。新UI不能以第三方功能表补齐不存在的后端。

风险项的范围、证据和待验证方式见P0_05；P0不执行修复。

