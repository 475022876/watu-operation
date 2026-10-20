# 供应商接入后的验收测试（三层口径）

> 适用版本：0.1.6。填入密钥之后的"怎么确认真的通了"，以本文为准。
> 本文只写**已实现的行为**；所有断言都能在代码里指出出处（见文末对照表）。

---

## 0. 一句话：三层测试，缺一层都不算验收

| 层 | 验什么 | 花多久 / 花钱吗 | 通过标准 |
| --- | --- | --- | --- |
| **L1 连通性** | 密钥、端点、模型名是否对 | 秒级；免费档 0 元，付费档 ≈ 30 tokens | 返回 `ok:true` + 就绪度变 `REAL` |
| **L2 真实任务** | 本系统整条管线能否产出可用结果 | 1–3 分钟；按实际 tokens 计费 | 作业 `SUCCEEDED` + 有产物 + 账本多一条 |
| **L3 负例与账本** | 拦截是否真的在拦、费用是否诚实 | 秒级；0 元 | 三类拦截都命中，账本数字对得上 |

**L1 通过 ≠ 接入完成。** 探针只发 `ping`，它证明的是"这把钥匙能开门"，
不证明"门里出来的东西能用于业务"。

---

## 1. L1 连通性探针

### 1.1 页面操作

侧边栏 **系统接入 → AI 能力接入** → 找到对应的能力卡 → 填好参数 → **保存接入配置**
→ 点 **测试连通性**（会弹出二次确认：这是一次真实调用，可能产生费用）。

保存后密钥框会清空，卡片上只剩掩码（`••••1a2b`）与指纹，就绪度从 `NOT_CONFIGURED`
变为 `CONFIGURED_NOT_TESTED`（显示为「已配置·未联调」）。

### 1.2 哪些能力有探针（重要）

| 能力 | 有低成本探针 | 测试连通性按钮的结果 |
| --- | --- | --- |
| 大语言模型（文本） | ✅ | 真发一次 `max_tokens=16` 的对话 |
| 网页检索 | ✅ | 真发一次 `site:bis.org Basel III` 检索 |
| 图像生成 | ❌ | `NO_PROBE_SUPPORTED` —— 生成图片必然计费，不做探针 |
| 视频生成 | ❌ | `NO_PROBE_SUPPORTED` —— 同上，且**视频没有免费档** |

图像/视频必须走 L2（用一条真实任务验），这也是为什么它们的按钮点下去会明确告诉你
"没有低成本探针，请在制作页用一条真实任务验证"，而不是假装成功。

> 已知文案瑕疵：当选的是「未接入」（`mode=none`）时，接口同样返回
> `NO_PROBE_SUPPORTED`，提示语读起来像是"该方式不支持探针"。
> 看到这条先确认卡片上是否真的选了供应商并保存过。

### 1.3 探针实际做了什么

**文本**：走与正式生成**完全相同**的 `chat()` 管线——数据分级 → 预算 → 端点校验（https/
端口/禁内网/白名单）→ 有界重试 → 记账，只是内容是
`system: "You are a health probe. Reply with the single word: ok"` / `user: "ping"`，
`max_tokens=16`、`temperature=0`。

所以"探针通过"等价于"正式调用的链路是通的"，不存在另写一条捷径骗过检查。

**检索**：一次最小检索，返回结果条数一并回传。

### 1.4 频率与返回

- 同一能力 **8 秒内不可重复**，否则 `TEST_TOO_FREQUENT`（防止手抖连点刷费用）。
- 成功返回：`{ok:true, latencyMs, model, mode, usage, readiness}`；
  失败返回 `{ok:false, code, message}`，`code` 见 §5。
- 每次探针都会写一条账本记录（`op=probe`），带上密钥指纹。

---

## 2. 就绪度三态：`REAL` 到底意味着什么

| 界面标签 | 内部值 | 含义 |
| --- | --- | --- |
| 未配置 | `NOT_CONFIGURED` | 没选供应商 / 没填密钥 / 密钥解不开 |
| 已配置·未联调 | `CONFIGURED_NOT_TESTED` | 参数齐了，但还没有一次成功调用作证 |
| 已真实联调 | `REAL` | 账本里有**当前这把密钥**的成功记录 |

判定条件（`providerlog.successEvidence`）：30 天内、同类型、`state=SUCCEEDED`、
且记账备注里的指纹等于**当前**密钥指纹。

三个由此推出的结论：

1. **探针通过就会变 `REAL`**，因为探针也是一次真实成功调用。
2. **换 Key 会自动回落**到「已配置·未联调」——旧证据的指纹对不上，不会拿旧成绩给新密钥背书。
3. **`REAL` 只说明链路通、凭据有效**，不说明输出质量、不说明内容合规。质量要靠 L2 人工看。

MOCK 模式永远不可能是 `REAL`。

---

## 3. L2 真实任务：证明它在本系统里真的能产出

页面入口已固定按**测试草稿**发起（`outputIntent=TEST_DRAFT`），不会被正式输出门禁挡住。
自己直调 API 时才需要注意这一点。

| 能力 | 页面路径 | 建议的第一条任务 |
| --- | --- | --- |
| 文本 | 内容制作 → 制作工作台 → AI 初稿 | 一段两三百字公开材料做「资料总结」 |
| 图像 | 内容制作 → 视觉工作室 | 一句不含品牌机密的产品场景描述，16:9 |
| 视频 | 内容制作 → 视频工作区 | 4 秒、竖版，先确认这条要花钱 |
| 检索 | 策划与情报 → 情报资讯 | 一个明确的事实型查询（如某监管机构最新指引） |

### 3.1 判定标准

文本/图像看三件事：作业状态 `SUCCEEDED`；产物真的落盘（图像出现在工作素材里）；
页面上**没有** MOCK 标记（`mock=false`）。

视频是异步的：提交后是 `PENDING`，需要轮询 `GET /api/mos/video-renders/:id`。
**未完成返回 `NOT_READY` 是正常的**，不是失败；系统不会把状态 JSON 当 MP4 存下来。

检索作业看 `completion`：`AI_RESEARCH_COMPLETE` 才代表 AI 完成归纳，
`RETRIEVAL_ONLY` 只代表抓到了网页——这两者**不允许混为一谈**。

### 3.2 直调 API 时的两个坑

- `outputIntent` 必须是 `FORMAL` 或 `TEST_DRAFT`，**其他任何值（含空）一律 409 阻断**
  （`FORMAL_OUTPUT_BLOCKED`），这是 fail-closed 设计，不是 bug。
- 正式输出（`FORMAL`）还要求 Skill 处于 `EFFECTIVE` 且审批通过，否则 409 / `SKILL_NOT_APPROVED`。
  验收阶段请用 `TEST_DRAFT`。

---

## 4. L3 负例三连 + 账本核对

正例通过只说明"能用"，负例通过才说明"不会乱花钱、不会泄数据"。

### 4.1 三个负例（都应在 1 分钟内完成）

| 负例 | 怎么做 | 期望结果 |
| --- | --- | --- |
| 错密钥 | 把 Key 改掉一个字符后保存并测试 | 失败，`PROVIDER_BAD_REQUEST`（HTTP 401 统一归类到此码）；账本记 `FAILED`；就绪度**不升** `REAL` |
| 机密数据 | 在 Brief 里放一个真实邮箱或手机号再生成 | `PROVIDER_BLOCKED_DATA_CLASS`，作业 `BLOCKED`，`providerJobId` 为空 = **零出站** |
| 预算上限 | 把单作业上限设成极小值（如 0.000001）再生成 | `PROVIDER_BUDGET_EXCEEDED`，**调用前**就拦下 |
| 端点安全 | 端点填 `http://` 或内网地址 | 保存/调用被拒，`PROVIDER_EGRESS_BLOCKED` |

注意"邮箱/手机号/身份证/银行卡/客户名单/KYC"会命中 `CONFIDENTIAL` 分级，
默认禁止外发；要放行必须由管理员在接入页显式开启并留下确认人（会写审计）。
**验收阶段不建议开这个开关**。

### 4.2 账本看什么

接入页底部的「调用账本」卡片，可切 7 / 30 / 90 天：

- **调用数**：探针与业务调用都计入；
- **成功率**：`ok / total`；
- **P95**：延迟分位，免费档限速时这个数字会明显抬高；
- **已确认费用**：**只累加供应商回执里给出的金额**；
- **未回执条数**：供应商没返回用量/计费的调用数。

费用口径是刻意的：**没有回执就不估算**，宁可显示"未回执 N 条"，也不按单价推算一个假数字。
所以"已确认费用 = 0"**不等于**"这次没花钱"，要看未回执条数。

---

## 5. 失败码对照

| 码 | 常见原因 | 处置 |
| --- | --- | --- |
| `PROVIDER_NOT_CONFIGURED` | 没选供应商 / 没密钥 | 回到接入页补齐 |
| `PROVIDER_UNKNOWN_MODE` | 供应商标识不在已实现列表 | 从下拉里选，别手填 |
| `PROVIDER_BAD_REQUEST` | 401 密钥错 / 400 模型名错 / 404 端点路径错 | 核对 Key、模型名、端点路径 |
| `PROVIDER_RATE_LIMITED` | 429，免费档限速 | 等 `Retry-After`，系统已做有界重试 |
| `PROVIDER_TIMEOUT` | 免费档首字慢 | 超时调到 60000ms |
| `PROVIDER_NETWORK_ERROR` | 本机代理 / DNS / 出网被拦 | 见 §6 |
| `PROVIDER_EMPTY_RESPONSE` | 返回 200 但无内容 | 换模型试；多为模型名与端点不匹配 |
| `PROVIDER_BLOCKED_DATA_CLASS` | 内容被判机密 | 脱敏，或（不建议）管理员开豁免 |
| `PROVIDER_BUDGET_EXCEEDED` | 触到单作业/月度上限 | 调整上限 |
| `PROVIDER_EGRESS_BLOCKED` | 端点不是 https / 私网地址 / 不在白名单 | 改端点 |
| `NO_PROBE_SUPPORTED` | 该能力没有探针（图像/视频），或还没选供应商 | 走真实任务 |
| `TEST_TOO_FREQUENT` | 8 秒内连点 | 等几秒 |

---

## 6. 本机环境特有的坑：代理

这台机器常驻系统代理。浏览器访问新域名可能被规则挡住，而 `curl` 不走代理反而正常。
如果页面点「测试连通性」失败、但命令行用同样的 Key 能通，先在代理软件里把
供应商域名设为直连再重试——**不要因此判定接入失败**。

---

## 7. 命令行版（无 UI 时用）

```bash
BASE=http://127.0.0.1:9080

# 1) 登录（口令换成你自己的）
curl -s -c /tmp/mos.txt -X POST $BASE/api/mos/auth/login \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"username":"admin","password":"你的口令"}'

# 2) 取 CSRF（写操作必须带，否则 403 CSRF_TOKEN_INVALID）
CSRF=$(awk '/mos_csrf/{print $7}' /tmp/mos.txt)

# 3) 看四类能力当前状态与就绪度
curl -s -b /tmp/mos.txt $BASE/api/mos/settings/providers -H "Origin: $BASE"

# 4) 跑一次文本探针（8 秒内只能一次）
curl -s -b /tmp/mos.txt -X POST $BASE/api/mos/settings/providers/text/test \
  -H 'Content-Type: application/json' -H "Origin: $BASE" -H "x-mos-csrf: $CSRF" -d '{}'

# 5) 看账本
curl -s -b /tmp/mos.txt "$BASE/api/mos/settings/usage?days=7" -H "Origin: $BASE"
```

`text` 可换成 `image` / `video` / `websearch`。后两者中的 image/video 会返回
`NO_PROBE_SUPPORTED`，属预期。

---

## 8. 验收记录表（建议每条接入都填）

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| L1 探针 | ok / 失败码 | latency、readiness |
| L2 真实任务 | SUCCEEDED / 其他 | 作业 ID、产物路径 |
| L3 错密钥 | 是否被拒 | 错误码 |
| L3 机密数据 | 是否零出站 | 作业 `providerJobId` 为空 |
| L3 预算 | 是否调用前拦截 | 错误码 |
| 账本 | 调用数是否 +N | 未回执条数 |

---

## 附：本文断言的代码出处

| 断言 | 位置 |
| --- | --- |
| 探针入口、8 秒节流、记账 | `lib/mos/provideradmin.js` `test()` |
| 文本探针走完整管线 | `lib/mos/adapters/text.js` `probe()` |
| 检索探针 | `lib/mos/adapters/websearch.js` `probe()` |
| 就绪度三态与证据判定 | `lib/mos/provideradmin.js` `readinessOf()`；`lib/mos/providerlog.js` `successEvidence()` |
| 图像/视频无探针 | `lib/mos/provideradmin.js` `KINDS.{image,video}.modes[*].probe=false` |
| 正式输出门禁 | `lib/mos/formalguard.js`、`lib/mos/routes/creative.js` |
| 费用只认回执 | `lib/mos/providerlog.js` `summarize()` |
| 数据分级拦截 | `lib/mos/egress.js`、`lib/mos/adapters/{text,image,video}.js` |
