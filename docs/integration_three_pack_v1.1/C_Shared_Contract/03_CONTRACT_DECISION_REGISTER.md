# CONTRACT DECISION REGISTER — 由双方共同填写，不得预填为已签署
| 编号 | 差异/决策 | 提供方负责 | 消费方负责 | 当前状态 | 协同完成证据 |
|---|---|---|---|---|---|
| D-00 | OA源码版本与提交号（已报告V1.1.7，正式签署） | 明确hash及构建 | 固定运行配置 | OPEN | 双方版本清单 |
| D-02 | 7种事件字面量与全局事件内容边界 | 确认 | 适配及断言 | OPEN | Schema+测试 |
| D-03 | 稳定错误码全集/向后兼容策略 | 确认 | 重试分类 | OPEN | Error Matrix |
| D-04 | knowledge/search filters schema | 确认 | 按需实现 | OPEN | 契约测试 |
| D-05 | 三种分页/游标语义 | 确认 | 各自解析 | OPEN | 契约测试 |
| D-06 | 三个准入必填字段与枚举、默认/人工映射 | 决策及规则 | UI、存储、迁移 | BLOCKING | 实例+校验 |
| D-07 | reviews[]准确schema | 决策 | UI提交+校验 | BLOCKING | 真实审核测试 |
| D-08 | Skill publicView字段、410/历史版本语义 | 确认 | 缓存策略 | OPEN | 契约测试 |
| D-09 | 事件seq截断、轮询和撤回失效时限 | 确认 | 持久轮询/全量重验 | BLOCKING | 故障注入 |
| D-10 | camelCase对外字段与兼容别名 | 冻结 | 统一 | OPEN | schema验证 |

**决议字段（每条必须补充）：** Provider reviewer、Consumer reviewer、决议时间、OpenAPI文件hash、是否兼容、代码提交、双侧断言、异议及后续变更单。不得由两个Codex虚构签名。
