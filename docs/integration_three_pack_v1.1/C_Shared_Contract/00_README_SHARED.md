# VFIB Shared Integration Contract V1.1 — 冻结前契约核对包
**交付范围：** 两个Codex项目均须读取；两边均不得擅自改动此目录中原始OpenAPI。
**实际来源：** 2026-10-13上传的OA源码包 `watu-oa-feat-v1.1.3 (2).zip` 内 `LIBRARY_HANDOFF_BUNDLE/PROVIDER_API_OPENAPI.yaml`；以及运营中台 `watu-operation-main (1).zip` 内 `MARKETING_HANDOFF_BUNDLE/CONTRACT_DIFF.md`。

## 事实与状态
- `PROVIDER_API_OPENAPI_BASELINE.yaml` **逐字节原样提取**，是当前提供方声称实施的基线，不代表双方签署V1.1，也不代表真实HTTP联调已通过。
- `CONSUMER_CONTRACT_DIFF_SOURCE.md` 为消费方提出的差异清单，部分仍标为 `PENDING_PROVIDER_CONFIRM`。**禁止**将其未经确认当成已解决事项。
- 共享契约版本V1.1为**本次整改工作包版本**；在Provider/Consumer完成字段核对、正式记录签署之前，运行协议仍以源码约定的1.0为准；不得把V1.1冒充已经部署的API版本。
- 外部服务凭据、真人权限授予、正式内容/Skill入库属于环境与人工审批前置条件，不能由测试脚本伪造。

## 统一冲突裁定
1. 先比对实际提供方OpenAPI、真实服务端实现与Consumer请求结构；差异记录在 `CONTRACT_DECISION_REGISTER.md`。
2. 若字段不匹配，先确定提供方的已发布权威契约；提供方确认后Consumer调整适配器；需要修改提供方则必须提出变更请求，提供方评审兼容性。
3. 所有合同/接口变更以编号、版本、责任人、决策、影响、迁移策略、双侧测试证据备案；不得各自修正契约版本。
4. 正式联调通过=两个独立进程/数据目录+真实HTTP往返+真实权限及日志证据；同进程mock测试不计入。

## 一票否决
无真实用户受限票据而仅依赖服务账号授权；普通审批绕过`library.asset.approve.final`；Approved资产未持久化却可复用；撤回仍可新授权使用；Published Content自动镜像到资料库；把UNVERIFIED字典、合成Skill、Mock/截图或未配置AI模型标为REAL PASS。
