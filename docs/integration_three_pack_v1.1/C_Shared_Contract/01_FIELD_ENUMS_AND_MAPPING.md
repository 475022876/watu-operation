# 字段、枚举和映射：以Provider原始契约核验为准
| 条目 | 当前Consumer差异说明中摘出的Provider要求 | 整改要求 |
|---|---|---|
| `libraryPrimaryCategory` | 必填，资料区 `01`–`07` | Provider给出**编号、正式名称、可提交目录和准入权限**；Consumer下拉引用，不自创编号；历史数据无可靠映射则待人工选择 |
| `classification` | 必填，`open/internal/restricted/executive` | Provider决定密级政策和谁可调整；默认遵循最小权限，不得擅自降密 |
| `licenseStatus` | 必填，`cleared/pending/restricted/expired/unknown` | Consumer自由文本 `INTERNAL_DRAFT` 等不得猜测映射为`cleared`，未知保守转`unknown`或要求用户确认；仅有`cleared`不代表可对外AI传输 |
| `reuseScope` | 可选默认`none`；现有临时口径`none/internal_reference/brand_kit/campaign_reuse/unrestricted` | 供应方确认含义及批准来源；默认none |
| `aiReusePolicy` / `externalAiTransferPolicy` | 可选默认`blocked` | 必须与文件读取权限独立；默认阻断 |
| `marketingCategory` | A01–A08 | 正式SPECIAL-01未批准核验前保持PROVISIONAL |
| `idempotencyKey` / `originObjectId` | 必填，`^[A-Za-z0-9_.:-]{1,120}$` | 提交保存稳定键，重试复用相同键；服务端幂等验收 |
| `brandId` / `title` | 必填，标题≤180 | 明确VFIB/U CARD隔离，禁止跨品牌复用旧审批 |
| `originSystem` | Provider强制 `marketing_os` | Consumer不得伪造自报 |
| `reviews[]` | submit要求有效`reviewerUserId`并有真实审核结论 | **待Provider核实逐字段schema及枚举**；不得自动生成通过审核的复核人 |
| JSON外部字段 | Consumer核对为camelCase | 双方以OpenAPI确定；严禁camel/snake混用引发静默丢字段 |

**区分三类游标：** `knowledge/search`使用`topK`且不等同分页；`assets/search`的`nextCursor`现为字符串形式下一offset；`changes`游标为单调递增seq。须逐接口确认、逐接口测试，不得统一以同一Cursor工具盲目解析。
