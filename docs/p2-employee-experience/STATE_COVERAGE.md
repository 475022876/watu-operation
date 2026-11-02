# P1 状态到 P2 的覆盖对应

所有状态均为本地模拟；服务端 capability、权限撤销和结果查询尚未真实集成。自动测试覆盖见逐例结果，以下是人工复现入口，不表示 32 项生产验收。

| ID | 状态 | 复现方式 |
| --- | --- | --- |
| T01 | actionable | 任务列表继续制作 |
| T02 | revision_requested | 退回修改任务 → 查看意见 |
| T03 | review_actionable | 切换专业审核员 → 待我审核 |
| T04 | due_soon | 即将到期筛选与任务截止时间 |
| T05 | empty_or_filtered | 空任务情境；搜索无结果 |
| T06 | denied_or_changed | read-denied / task-changed 情境 |
| C01 | task_context | 任务要求与资料抽屉 |
| C02 | free_creation | 侧栏文字制作 → 自由创作 → 保存到任务 |
| C03 | generating | 发送后本地等待，按钮暂时不可用 |
| C04 | candidate_ready | 生成后明确选用候选 |
| C05 | dirty_selection | 修改当前作品后再选候选，取消或确认 |
| C06 | unsupported_model_budget_or_failure | not-configured / budget / generation-failed |
| C07 | file_uploaded_not_used | 添加资料，分别选择审核附件与生成使用 |
| C08 | file_denied_unreadable_or_upload_failed | file-denied / file-unreadable / upload-failed |
| C09 | dirty_work | 修改正文，送审不可用 |
| C10 | saving | slow-save 情境，保存中修改 |
| C11 | saved_current | 保存当前作品后打开送审确认 |
| C12 | save_failed | save-500 / offline，保留正文 |
| C13 | save_conflict | save-409 → 比较后明确处理 |
| C14 | save_unknown | save-unknown-applied / save-unknown-unapplied → 查询 |
| C15 | edited_during_save | slow-save 后继续编辑，再次保存 |
| C16 | draft_recovery_or_leave | draft-recovery → 先预览；离开未保存提醒 |
| C17 | submit_confirmation_or_inflight | 送审确认只列当前作品与选定附件 |
| C18 | switch_or_revoke | slow-response 中切换品牌；revoked |
| R01 | professional_pending | 切换专业审核员 → 审核冻结版本 |
| R02 | publication_pending | professional 通过后切 publisher；publication-wait |
| R03 | return_comments_required | 退回必须填写意见 |
| R04 | revision_and_resubmission | 作者修改重提，查看原意见仍保留 |
| R05 | approved_not_published | 两级通过，显示通过但未发布，无执行发布 |
| R06 | denied_self_or_revoked | self-review / review-denied |
| R07 | subject_changed | subject-changed |
| R08 | decision_unknown_or_concurrent | decision-unknown → 查询，不自动重放 |
