# UI_BROWSER_EVIDENCE —— 真实浏览器复测证据（P1—P4）

> 需求：B 包 Phase B2「**P1—P4 真实浏览器复测**，对照界面截图清单以及高风险审核、内容版本和用户权限路径；
> **UI 不可用时不得写 PASS**」
> 生成方式：`bash tools/run-mos-tests.sh ui` → `tools/mos-ui-check.js`
> 驱动方式：**CDP 驱动本机真实 Chrome/Edge**（非无头模拟、非 DOM 造假）
> 结果：**106/106 通过**，`runAt`/`build` 见 `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json`

---

## 1. 断言覆盖（106 条，节选关键路径）

| 类别 | 覆盖内容 |
| --- | --- |
| 登录 / 强制改密 | 引导管理员首登→强制改密→重新登录 |
| 八个工作中心 | 逐页导航 + **页头断言**（不只看"有标题"） |
| 品牌 / 规划 / 情报 / 创作 / 发布 / 分析 / 治理 | 页面可达 + 关键区块渲染 |
| **高风险审核** | 审核单详情、决策入口、权限受限时的拒绝呈现 |
| **内容版本** | 内容版本与 Manifest 绑定、送审/回退路径 |
| **用户权限** | 普通身份与授权身份的可操作集差异 |
| **真实写操作 + 刷新后持久化** | 规划与情报条目**经 UI 真实创建 → 刷新 → 仍在**（不是"打开看一眼"） |
| 运行时健康 | 无页面级未捕获异常；**无 console error** |
| 采集调度（A-01） | 调度开关双向可用、来源登记表展示采集频率与「不自动」标识 |

> 说明：`mos-ui-check.js` 会对**未知路由静默早返回**，因此所有导航断言**必须比对期望页头**，
> 仅断言"存在标题"会误判通过 —— 这一约束已固化在检查实现中。

---

## 2. 截图清单（28 张）

| 文件 | 内容 |
| --- | --- |
| `01-login.png` | 登录页 |
| `02-force-password.png` | 强制改密页 |
| `03-my-work.png` | 我的工作 |
| `04-workspace-my-work.png` | 工作中心·我的工作 |
| `05-workspace-projects.png` | 工作中心·项目 |
| `06-brand-overview.png` | 品牌总览 |
| `07-brand-guidelines.png` | 品牌规范 |
| `08-brand-reference.png` | 品牌参考 |
| `09-planning-list.png` | 规划列表 |
| `10-topics.png` | 选题 |
| `11-intelligence.png` | 情报 |
| `12-all-tasks.png` / `12-content-tasks.png` | 任务（全部 / 内容） |
| `13-campaigns.png` | Campaign |
| `14-creative-stage.png` | 创作阶段 |
| `15-publishing-stage.png` | 发布阶段 |
| `16-analytics-stage.png` | 分析阶段 |
| `17-governance-stage.png` | 治理阶段 |
| `18-planning-calendar.png` / `19-planning-calendar-week.png` | 规划日历（月 / 周） |
| `20-intelligence-sources.png` / `21-intelligence-source-detail.png` | 情报来源 / 详情 |
| `22-planning-created-by-ui.png` | **经 UI 真实创建**规划 |
| `23-planning-after-reload.png` | **刷新后仍在**（持久化） |
| `24-intelligence-created-by-ui.png` | **经 UI 真实创建**情报 |
| `25-intelligence-after-reload.png` | **刷新后仍在**（持久化） |
| `99-error.png` | 错误态呈现 |
| `B1-38-admission-dialog.png` | 资产准入对话框（三必填字段） |

---

## 3. 与 P1—P4 角色的对应

| 角色 | 本轮复测路径 |
| --- | --- |
| **P1 战略治理** | 品牌/规划/情报/治理中心；采集调度开关与来源登记 |
| **P2 创作** | 创作阶段、内容任务的创建与提交 |
| **P3 发布** | 发布阶段、发布排期与审批入口可达性 |
| **P4 产品营销** | 项目/任务/Campaign 视图 |

> ⚠ 上述复测使用**合成身份**登录；**不代表**真实员工的权限验收（真实人员授权见 `JOINT_SIGNOFF_V1.2.md`）。

---

## 4. 复现

```bash
cd D:/运营系统/VFIB-Marketing-OS
bash tools/run-mos-tests.sh ui        # 需要本机 Chrome/Edge；缺失时按**失败**计，不写 PASS
```

**UI 不可用时本侧不会写 PASS**：`run-mos-tests.sh` 对 `ui` 套件在浏览器缺失时按失败计并返回非 0 退出码。
本轮本机 Chrome/Edge 可用，故为真实通过（106/106）。
