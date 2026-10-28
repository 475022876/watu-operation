# Phase 3A-2 H05 字段关联修复

日期：2026-10-28；修复提交 `5cd6a33`，来源为 Phase 3A-1 风险提示，实际复现确认后仅修正一处字段。

## 原缺陷与代码变化

`lib/mos/workspace-ai-policy.js` 遍历 content_versions 时使用 `v.taskId === task.id`。实际内容版本字段为 `contentTaskId`，导致只挂在版本 refAssetIds 下的 Workspace 素材未被引用收集器发现，可能遗漏模型外发检查。

改为 `v.contentTaskId === task.id`。没有增加默认放行、删除授权检查、改动密级映射或 Enterprise Workspace API。其他直接引用路径保留。

## 修复前后实测

```powershell
node tools/phase3a2/h05-version-reference-test.cjs
node tools/phase3a2/run-security-regression.cjs
```

测试以实际 contentTaskId、版本→working asset→libraryAssetRef 构造链路。原 bbd3658 策略：2/12 PASS、10 FAIL；修复后：12/12 PASS。证据 h05-before.json / h05-after.json。

负例覆盖 Restricted、Executive Confidential、未知密级、缺少可信元数据、已撤销访问、禁止外发、跨品牌、撤销用户权限；正常已授权资料按规则通过，直接引用控制组及无引用控制组保持行为。

本轮另重新运行 Phase 2 H05 策略22项及真实消费者 adapter 边界3项，均通过。这里的权限权威使用本地合成 stub/隔离 HTTP fixture，**不是实际 Enterprise Workspace 联调或收费模型外发成功**。

## 影响与回滚

影响仅内容版本关联引用的收集路径，避免该路径绕过既有授权策略。17套业务回归880/880、Phase1 57/57、Phase2 53/53，无新增失败。没有扩张到其他资料策略重构。

可独立审查/回滚 5cd6a33，但直接撤销会恢复已确认授权遗漏，应保留修复或先停用受影响外发路径。本阶段未上线，不操作生产。更广泛真实 Workspace 权限撤销时效仍待后续授权联调。
