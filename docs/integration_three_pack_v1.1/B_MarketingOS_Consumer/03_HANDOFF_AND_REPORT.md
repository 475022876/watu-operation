# 运营中台交付要求
输出 `MARKETING_HANDOFF_BUNDLE_V1.1/`：
- `CONSUMER_BASELINE.md` 双方Git/应用/合同版本、SHA256。
- `CONTRACT_DIFF_SIGNED.md` D-00至D-10双侧决定、仍未确认项（不能伪签）。
- `ADMISSION_FIELDS_UI_DATA_MIGRATION.md` 三项字段、历史迁移/回滚和表单截图。
- `AUTH_AND_EVENTS_REPORT.md` 签名票据、轮询、截断、撤回、fail-closed及测试命令。
- `REAL_HTTP_E2E_EVIDENCE.md` 两端requestId、时间、响应摘要、状态、环境；脱敏日志。
- `PUBLISHED_CONTENT_ISOLATION.md` 归档快照与Provider无镜像证据。
- `SKILL_AND_DICTIONARY_STATUS.md` 正式文件/批准状态、未核验项。
- `AI_PROVIDER_REAL_MOCK_STATUS.md` 真调用与mock独立标识。
- `UI_BROWSER_EVIDENCE/` P1–P4及审批/失败场景。
- `SECURITY_REGRESSION.md` 全量测试+安全回归与备份恢复。
- `JOINT_ACCEPTANCE_REPORT.md` 根据共享14项矩阵逐项PASS/FAIL/BLOCKED/NOT_RUN，由双方确认。
- `CHANGELOG.md` 修改清单、未完成项、部署与回滚。

**验收门槛：** 所有P0场景具备真实HTTP日志；无未经授权资产可复用、无发布成品镜像、无普通管理员绕过最终审批；所有关键外部阻断如实报告。未经用户批准不得上线生产。
