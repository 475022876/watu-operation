# VFIB双项目接口契约对齐与真实联调补充整改 V1.1（三包制）
本交付由三个**文件包**构成，Codex项目仍然只有两个：A企业资料库（Provider）、B营销运营中台（Consumer）；C为双方只读共享标准，不是第三个开发项目。

## 正确分发
1. 给**企业资料库Codex**：`A_Workspace_Provider.zip` + `C_Shared_Contract.zip`，使用A的`03_CODEX_DIRECT_PROMPT.md`。
2. 给**运营中台Codex**：`B_MarketingOS_Consumer.zip` + 同一份`C_Shared_Contract.zip`，使用B的`04_CODEX_DIRECT_PROMPT.md`。
3. 两边可并行完成各自代码准备；**真实联调以资料库先交付Provider Handoff为前提**。双方各自只修改自己的仓库，禁止交叉提交。
4. Codex不能自行授予真实最终批准权限、不能伪造批准的品牌手册/Skill，不能把Mock接口、历史自审或单侧fixture记录为联合验收PASS。

## 当前证据基线
- 提供方OpenAPI来自用户最新OA源码的 `LIBRARY_HANDOFF_BUNDLE/PROVIDER_API_OPENAPI.yaml`，放入C包并保持文件字节不变。
- 消费方差异来自最新MOS源码的 `MARKETING_HANDOFF_BUNDLE/CONTRACT_DIFF.md`，亦作为证据原样包含C包；其PENDING条目必须交互确认。
- 本次V1.1是**整改指令版本**，绝非宣告线上API已升级到V1.1或两系统已集成通过。

## 推荐执行
① A确认差异和合同 → ② B修改消费侧字段和事件机制 → ③ A交付可用Staging + Handoff → ④ B牵头真实HTTP联合E2E → ⑤ 双方独立回归+共同签署验收 → ⑥ 用户审计批准后再决定试运行。
