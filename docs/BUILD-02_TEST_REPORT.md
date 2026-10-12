# Marketing OS V0.1 — BUILD-02 测试报告（Gate B）

> 运行时间：2026-10-12
> 运行入口：`bash tools/run-mos-tests.sh all`
> 结论：**200/200 断言通过，0 失败**，BUILD-01 回归无破坏。

## 1. 总体结果

| 套件 | 断言 | 结果 | 证据文件 |
|---|---|---|---|
| smoke（BUILD-01 冒烟） | 13 | 13/13 | `TEST_EVIDENCE_MOS_BUILD01/smoke-result.json` |
| unit（BUILD-01 单元） | 25 | 25/25 | `TEST_EVIDENCE_MOS_BUILD01/unit-result.json` |
| e2e（BUILD-01 E2E-01/02） | 47 | 47/47 | `TEST_EVIDENCE_MOS_BUILD01/e2e-result.json` |
| **e2e02（BUILD-02 E2E-03/04）** | **63** | **63/63** | `TEST_EVIDENCE_MOS_BUILD02/e2e-build02-result.json` |
| ui（真实 Chrome CDP） | 52 | 52/52 | `TEST_EVIDENCE_MOS_BUILD01/ui-check-result.json` |
| **合计** | **200** | **200/200** | `TEST_EVIDENCE_MOS_BUILD01/summary.json` |

## 2. BUILD-02 端到端（E2E-03 / E2E-04，63 断言）

隔离数据目录 + 运行期随机口令，结束后即清理，不触碰 `data/`。

### 2.1 E2E-03 AI 创作与审核链

| 断言 | 验证点 |
|---|---|
| E2E03-01 | Skill 清单可读且声明可用性（VFIB = `REFERENCE_ONLY`） |
| E2E03-02 | 创建内容版本草稿（`DRAFT`，number=1） |
| E2E03-03 | 草稿可编辑且正文哈希随之变化（`c4fb727b → 17e7d15c`） |
| E2E03-04/05 | 冻结送审 → `LOCKED_FOR_REVIEW`，固化 Manifest 哈希与清单快照 |
| SEC-02-a | 冻结后直接改写 → `409 VERSION_IMMUTABLE` |
| E2E03-06 | G2 内容自动生成「专业审核 + 发布审批」两条**独立**链 |
| E2E03-07/08 | 职责分离：创作者审批自己 → `403`；有身份无审核权（P4）→ `403` |
| E2E03-09 | 专业审核未过时发布审批被阻塞 → `PROFESSIONAL_REVIEW_PENDING` |
| E2E03-10/11 | 专业审核批准 → 发布审批批准 → 版本 `APPROVED`，任务联动 `READY` |
| E2E03-13/14 | 派生新版本 → v2 `DRAFT`；旧版本标记 `SUPERSEDED` 且**不删除** |
| E2E03-15 | 文本 Provider 未配置 → 作业 `NOT_CONFIGURED`，**不伪造输出** |
| E2E03-16 | 同一 `idempotencyKey` 重复提交 → `deduplicated`，不重复执行 |
| E2E03-17 | 预算闸门在调用 Provider **之前**拦截 → `BUDGET_EXCEEDED` |
| E2E03-18/19/20 | U CARD 未批准 Skill → FORMAL 阻断；VFIB 仅 `REFERENCE_ONLY` → FORMAL 同样阻断；TEST_DRAFT 放行并返回生效规则哈希 |

### 2.2 E2E-04 传播（排期 / 发布 / 归档）

| 断言 | 验证点 |
|---|---|
| E2E04-01 / SEC-04-a | 渠道可读且含启用渠道；**渠道数据不含任何口令/令牌字段** |
| E2E04-00a/b/c | 独立草稿 → G1 送审只生成发布审批链 → 批准后 `APPROVED` |
| SEC-04-b/c | 未批准版本的排期只能落 `BLOCKED`；强推 `READY` → `409 NOT_APPROVED` |
| E2E04-02/03/04 | 已批准版本排期进入 `READY`；非法迁移 `READY→DRAFT` → `ILLEGAL_TRANSITION`；`READY→SCHEDULED` 正常 |
| E2E04-05 | 无真实 URL / 证据引用不能登记发布 → `MISSING_PROOF` |
| E2E04-06/07/08 | 人工登记发布 → `PUBLISHED`，带正文哈希与清单哈希；快照**物理落盘**（`content.md` + `manifest.json`） |
| E2E04-09 | 归档正文从快照读取（非工作副本），只读可读 |
| E2E04-10/11 | 追加更正事件；原归档快照**仍保留**（append-only） |
| E2E04-12 | 发布指标以人工登记方式记录（含来源与截止日） |
| E2E04-13/14 | **系统不存在自动发布**：排期到期等待 2.6s 后状态与归档均不变 |
| PUB-01/02 | 日历与排期同一数据源（区间条目数完全一致）；日历显式声明状态色不单独表达含义 |
| SEC-04-d/e | 渠道登记拒绝密码字段 → `SECRET_NOT_ALLOWED`；URL 强制 HTTPS → `BAD_URL` |

### 2.3 视频工作区（首期范围）

| 断言 | 验证点 |
|---|---|
| VID-01 | 按任务惰性创建，初始 `BRIEF` |
| VID-02/03 | 保存脚本 → `SCRIPT`；保存分镜 → `STORYBOARD` |
| VID-04/05 | 字幕时间倒置 → `400 BAD_SUBTITLE`；合法字幕 → `SUBTITLE` |

### 2.4 SEC-02 真实篡改路径（关键）

不是模拟调用，而是**真正绕过应用层改写磁盘数据**：

```
送审得到绑定 Manifest 的审核单
  → 等待异步落盘并轮询确认（version=true case=true）
  → 停止服务进程
  → 直接改写 data/mos.json 中该版本的 body（模拟底稿被外部篡改）
  → 重启服务重新加载被篡改的数据
  → GET 审核详情 → manifestMatches === false
  → POST 批准 → 409 MANIFEST_CHANGED
  → 审核单未被改动（仍 SUBMITTED）
```

结论：**批准对象与 Manifest 强绑定，事后篡改底稿无法通过审批。**

## 3. UI 检查（真实 Chrome，52 断言）

通过 CDP 驱动本机 Chrome，非模拟 DOM。BUILD-02 段落验证的是**真实写操作 + 刷新后持久化**，
不是"打开页面看一眼"。

| 断言 | 验证点 |
|---|---|
| 模块渲染 ×17 | 每个路由断言**期望页头**（旧写法只断言"有标题"，路由失效时会静默回退仍判通过，已修正） |
| B02-UI 内容编辑器 | 三栏渲染；界面内新建草稿；修改正文提示"未保存"；**保存后刷新仍在**；送审冻结后正文变为 `readOnly` |
| B02-UI 我的审核 | 默认只列"我可裁决"，**作者本人被职责分离过滤**；取消勾选后审核单可见 |
| B02-UI 视觉工作室 | 受控提示词预览返回生效规则哈希；显式展示 Skill 未批准状态 |
| B02-UI 视频工作区 | 界面内添加脚本分节并保存 → 阶段条推进；**刷新后脚本仍在** |
| B02-UI 发布中心 | 四视图切换；渠道表渲染真实渠道行；日历渲染月网格；页面明示"系统不会自动发布" |
| 无页面级异常 | `pageErrors` 与 `console.error` 均为 0 |

截图证据：`UI_EVIDENCE_MOS_BUILD02/B02-14 … B02-28`（15 张）。

## 4. 本次发现并修复的缺陷

| # | 缺陷 | 严重度 | 修复 | 回归证据 |
|---|---|---|---|---|
| A-09 | `MOS_DATA_DIR` 隔离可被绕过：`lib/mos/config.js` 定位数据文件前不保证 `getConfig()` 已执行，先触碰 store 的入口（自检脚本/CLI）会把数据写进真实 `data/` | **高** | `getMosConfig()` 内先调用 `getConfig()` | 迁移测试现落在 `.migtest/`，真实 `data/` 不受影响 |
| A-10 | v1→v2 升级路径不补种渠道/Skill/模板，导致升级库的发布页**完全不可操作**（无 ENABLED 渠道则排期无法建立） | 中 | `migrate()` 在 `priorVersion<2` 且开启 demoSeed 时补种空集合；已 v2 的库不触碰（不复活用户清空的数据）；另提供 `tools/mos-seed-build02.js` | v1 fixture 补种 2 Skill/4 模板/3 渠道；v2 空 fixture 不复活 |
| A-11 | **Skill 正式输出门禁失效开放**：`outputIntent === 'FORMAL'` 之外的一切取值（含 `FORMAL_OUTPUT`、拼写错误、漏传）都静默降级为最宽松的测试草稿 | **高（合规）** | 引入别名表 + **未识别取值一律阻断** | E2E03-19 由 FAIL 转为 PASS |
| A-12 | UI 检查"模块渲染"断言过弱：只检查"存在标题"，路由不存在时页面停留在上一模块仍判通过 | 中 | 每个路由断言期望页头 | 旧用例下 `creative` 误判通过，修正后可暴露此类失效 |
| — | 内容编辑器冻结 toast 恒显示"生成 0 张审核单"（读错字段 `r.cases`，实为 `createdCases`） | 低 | 改读 `createdCases` | 浏览器复测 toast 数字正确 |

## 5. 已知未验证 / 明确不做

- `openai` 图像 Provider 与 `deepseek` 文本 Provider 为**代码就绪、无 Key 未验证**：环境无任何供应商密钥，
  因此真实调用路径无法在本环境跑通。这不是"已打通"，而是"未验证"——矩阵中如实标注。
- 视频自动渲染/配音/剪辑为规范明确排除项（04 §2），未实现。
- 真实 OA / 企业资料库 / 知识库 / SSO 仍为未接通（Gate D 未开始）。
