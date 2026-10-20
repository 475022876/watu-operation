# 供应商选型建议（V0.1.4 接入用）

> 核实日期：**2026-10-20**（选型）｜视频模式改造落地：**0.1.5**｜零付费试用：见 **`docs/FREE_TIER_TESTING.md`**
> （本文是**正式采购**用的选型与价格；只想先把功能跑通、暂不充值，请看那份手册）。所有价格取自各厂商官方定价页或官方 API 文档，**未做推算**；
> 厂商调价频繁，最终以你在控制台看到的账单为准。
> 本文只给"选什么、填什么"，不涉及任何凭据。填 Key 的步骤见 `docs/PROVIDER_INTEGRATION_GUIDE.md`。

---

## 0. 先说结论

| 能力 | 推荐 | 一句话理由 |
| --- | --- | --- |
| 文本（五类产出） | **DeepSeek `deepseek-v4-pro`** | 中文研究报告/选题质量足够、1M 上下文装得下长材料、空闲时段 4.5 元/百万输入 ≈ 竞品 1/3 |
| 图像 | **火山方舟 `doubao-seedream-5-0-lite`** | **协议与我们完全一致**（OpenAI `/images/generations`），0.22 元/张，国内直连 |
| 视频 | **火山方舟 `doubao-seedance-2-0-mini`** | 720P 0.18 元/秒，是国内最便宜的可商用档；**但需先改一处适配器**（见 §5） |
| 网页检索 | **自建 SearXNG** | 零调用费、数据不出内网、可指定权威站点白名单 |

**如果你的英文文案是硬需求**，文本换成 **Claude Sonnet 5**（$2/$10，英文母语感明显更好），其余保持不变。

**一句话风险提示**：文本供应商在系统里是**单条配置**，不能按任务自动路由（见 §7）。
「中文报告用 DeepSeek、英文文案用 Claude」目前需要到页面上切换——除非后续做按任务路由（见 §7）。

---

## 1. 逐项对比：文本（text）

系统支持三种协议形状：`openai` / `deepseek` / `anthropic`，都已在适配器里实现。

### 1.1 候选与价格

| 模型 | 协议模式 | 输入 / 输出（每百万 token） | 上下文 | 中文报告 | 英文文案 |
| --- | --- | --- | --- | --- | --- |
| **DeepSeek V4-Pro** | `deepseek` | 空闲 **4.5 / 13.5 元**；高峰 **9 / 27 元** | 1M | 强 | 良 |
| DeepSeek V4.1-Flash | `deepseek` | 空闲 1.5 / 4.5 元；高峰 3 / 9 元 | 1M | 良 | 中 |
| **Qwen3.8-Max** | `openai` | 12 / 36 元 | 1M | **最强** | 良 |
| Qwen3.8-Plus | `openai` | 3.2 / 9.6 元 | 1M | 强 | 良 |
| **Claude Sonnet 5** | `anthropic` | **$2 / $10**（约 14 / 72 元） | 200K | 强 | **最佳** |
| Claude Opus 5 | `anthropic` | $5 / $25 | 200K | 强 | 最佳 |
| GPT-6 Sol | `openai` | $2 / $10 | 270K+ | 强 | 最佳 |
| GPT-6 Luna | `openai` | $0.10 / $0.50 | 270K+ | 中 | 中 |

> DeepSeek 是**峰谷定价**：高峰 = 北京时间 9:00–12:00、14:00–18:00，其余为空闲（半价）。
> 营销团队的实际使用高峰恰好落在这两个区间，做预算时**按高峰价估**更保守。

### 1.2 直接可填的配置

**方案 A：性价比首选（推荐）**

| 字段 | 值 |
| --- | --- |
| 供应商 | `deepseek` |
| 端点 Base URL | `https://api.deepseek.com/v1` |
| 模型 | `deepseek-v4-pro` |

**方案 B：中文质量优先**

| 字段 | 值 |
| --- | --- |
| 供应商 | `openai`（OpenAI 兼容协议） |
| 端点 Base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 模型 | `qwen3.8-max` |

**方案 C：英文文案优先**

| 字段 | 值 |
| --- | --- |
| 供应商 | `anthropic` |
| 端点 Base URL | `https://api.anthropic.com/v1` |
| 模型 | `claude-sonnet-5` |

> **为什么不用 `openai` 模式接 OpenAI 官方？** 可以，但要考虑两件事：
> 一是生产环境需能稳定访问 `api.openai.com`（国内需代理，属运维风险）；
> 二是客户资料外发涉及数据出境，需先过合规。国产模型在这一点上摩擦更小。
> 系统已支持，切换只是改配置，不用改代码。

### 1.3 成本测算（按一个中等强度团队估算）

假设每月：研究报告 20 篇（输入 3 万 / 输出 4 千）、资料总结 100 次（1 万 / 2 千）、
选题 200 次（2 千 / 1 千）、英文文案 100 次（3 千 / 1.5 千）、视频脚本 50 次（2 千 / 1.5 千）。

| 模型 | 月成本（估算） |
| --- | --- |
| DeepSeek V4-Pro（全按**高峰**价） | **≈ 40 元** |
| DeepSeek V4-Pro（全按空闲价） | ≈ 20 元 |
| Qwen3.8-Max | ≈ 54 元 |
| Claude Sonnet 5 | ≈ **$12 ≈ 85 元** |
| GPT-6 Sol | ≈ $12 ≈ 85 元 |

结论：**文本这一项的成本差异在同一条数量级内，不值得为省钱牺牲质量**。
真正会爆预算的是图像和视频（§3、§4），预算闸门应该优先设在那两项。

### 1.4 一个省钱的实操点（需要我改一行）

DeepSeek V4 系列**默认开启思考模式**，思考 token 计入输出。
五类营销产出（总结/选题/文案/脚本）基本不需要长链推理，关掉思考可省 30–60% 输出费用。
当前适配器没有下发 `thinking: {type:'disabled'}`。**这是一项可选优化，我没有私自加**——
因为一旦加上，`REPORT`（研究报告）这类需要推理的任务质量可能下降。
建议：先按默认跑一周，看账本里的实际输出 token 再决定。

---

## 2. 逐项对比：图像（image）

系统只支持 **OpenAI 兼容的 `/images/generations`**，请求体 `{model, prompt, size, n}`，
接受 `b64_json` 或 `url` 两种返回。

### 2.1 候选

| 供应商 | 端点 | 模型 | 单价 | 协议 |
| --- | --- | --- | --- | --- |
| **火山方舟** | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seedream-5-0-lite-260128` | **0.22 元/张** | ✅ 完全兼容 |
| 火山方舟 | 同上 | `doubao-seedream-5-0-pro-260628` | 0.30（≤1.5K）/ 0.60（>1.5K） | ✅ |
| 火山方舟 | 同上 | `doubao-seedream-4-5` | 0.25 元/张 | ✅ |
| OpenAI | `https://api.openai.com/v1` | `gpt-image-2.5-sunburst` | $8/1M 图像输入 + $30/1M 输出 | ✅ |
| OpenAI | 同上 | `gpt-image-2` | $4/1M + $15/1M | ✅ |

**推荐火山方舟 Seedream**：协议零摩擦（官方文档直接给了 OpenAI SDK 的调用示例）、
国内直连、按张计费且**未成功输出不计费**——这一点对"审图不过"的营销场景很关键。

### 2.2 直接可填的配置

| 字段 | 值 |
| --- | --- |
| 供应商 | `openai` |
| 端点 Base URL | `https://ark.cn-beijing.volces.com/api/v3` |
| 模型 | `doubao-seedream-5-0-lite-260128` |

⚠ **一个已知细节**：系统的比例映射会下发 `size: 1024x1024`（1:1）或 `1536x1024`（16:9）。
Seedream 官方示例多用 `"2K"` 这种档位字符串。**像素值 Seedream 也接受**，但如果你在测试连接时
拿到尺寸相关的 400，把页面上的模型换成 `doubao-seedream-4-5` 或用 `2K` 档位重试一次就能确认。
这属于需要真实密钥才能验证的点，**我没有凭据，不假装验证过**。

---

## 3. 逐项对比：视频（video）

### 3.1 先说最重要的事实

**OpenAI Sora 2 的视频 API 已于 2026-09-24 停止服务**，`sora-2` / `sora-2-pro` 全部别名与快照一并下线，
OpenAI **没有公布继任模型**。消费端 App 更早在 4 月 26 日就关了。

这意味着：系统里 `openai` 模式的 `/videos` 三步链路（start → check → download）
**现在没有任何可用供应商**。它是按一个已经死掉的协议实现的——不是我们写错，是上游没了。

### 3.2 国内可用替代与价格

| 平台 | 模型 | 分辨率 | 单价（元/秒） | 5 秒单条 |
| --- | --- | --- | --- | --- |
| **火山方舟** | `doubao-seedance-2-0-mini` | 720P | **0.18** | 0.90 元 |
| 火山方舟 | `doubao-seedance-2-0-mini` | 480P | 0.08 | 0.40 元 |
| 火山方舟 | `doubao-seedance-2-0-fast` | 720P | 0.41 | 2.05 元 |
| 火山方舟 | `doubao-seedance-2-0` | 720P / 1080P | 1.50 / 3.75 | 7.5 / 18.75 元 |
| 火山方舟 | `wan-3-0`（万相） | 720P / 1080P | 0.99 / 1.98 | — |
| 可灵 | Kling 3.0 | 720P / 1080P | $0.10 / $0.129 | $0.50 / $0.65 |

> 视频是**唯一会让预算失控**的一项：一条 1080P 的 10 秒片 = 37.5 元，一个月 100 条就是 3750 元。
> 建议在页面上把「单次预估上限」设在 **5 元以内**，强制走 720P。

### 3.3 为什么现在还不能直接接（技术原因）

我们的 `generic` 模式虽然可自定义路径，但与国产异步视频协议有**两处硬差异**：

| 环节 | 我们的实现 | 火山方舟实际 |
| --- | --- | --- |
| 创建任务 | `POST {base}{createPath}`，体 `{model, prompt, duration, size}` | `{model, content:[{type:'text',text:'...'}], duration, ratio}` |
| 取任务 id | 读 `id / task_id / taskId / data.id` | 返回 `{id}` ✅ 兼容 |
| 查询状态 | `GET {base}{statusPath}`，读 `status / state` | `{status, content:{video_url}}` ✅ 兼容 |
| **下载成片** | `GET {base}{contentPath}`，**直接期望二进制** | ❌ 没有二进制端点，只给 **24 小时有效的 `content.video_url`** |

也就是说：**前三步都能通，第四步会拿到一段 JSON 而不是 MP4**，然后按 120MB 上限校验时报"下载内容为空/非法"。

### 3.4 已改造完成（0.1.5）

原文写的是"需要改"，**现在改完了**。`lib/mos/adapters/video.js` 已新增 `volcengine` 模式：

1. **创建**：把 `{model, prompt, duration, size}` 改写为
   `{model, content:[{type:'text',text:prompt}], duration, ratio, watermark:false}`；
   `size` 若是像素值（`1536x1024` / `720x1280`）自动翻译成 `16:9` / `9:16`，也接受直接传 ratio 枚举。
2. **下载**：先查一次状态取 `content.video_url`，再对该 URL 发起 GET——
   **仍走 `egress.assertProviderUrl`**，不是绕开安全校验的裸取。
3. **未完成拒绝下载**：状态不是 `succeeded` 时明确报 `NOT_READY`，绝不把状态 JSON 当 MP4 落盘。
4. `provideradmin` 已注册该模式；`egress.knownVendorHosts` 本就含 `ark.cn-beijing.volces.com`，白名单未改。
5. 记录账本：下载前的那次状态查询**是真实发生的请求，如实记账**，不隐藏。

测试覆盖（`provideradmin` 套件 `PB-17a…17e` 共 5 条）：创建体形状、未完成拒绝下载、
`succeeded` 识别并带回 url、从 url 下载落盘且字节一致、竖版尺寸翻译。

**现在直接可填的配置：**

| 字段 | 值 |
| --- | --- |
| 供应商 | `volcengine` |
| 端点 Base URL | `https://ark.cn-beijing.volces.com/api/v3` |
| 模型 | `doubao-seedance-2-0-mini`（720P 0.18 元/秒）或 `doubao-seedance-2-0-fast`（0.41） |

> 仍然保留 `openai` 模式：若 OpenAI 后续推出 Sora 继任者且恢复 `/videos` 三端点，无需改代码。
> **但当前它是死路**（上游已下线），不要选它。

---

## 4. 逐项对比：网页检索（websearch）

系统支持 5 种：`searxng` / `brave` / `bing` / `google` / `tavily`。

| 方案 | 费用 | 需 Key | 适合 |
| --- | --- | --- | --- |
| **自建 SearXNG** | 0（只花服务器） | 否 | **推荐**。可设权威站点白名单、结果不出内网 |
| Brave Search API | 有免费额度，超出按次 | 是 | 英文源覆盖好 |
| Tavily | 按次 | 是 | 已为 LLM 优化过摘要，省二次抓取 |
| Bing / Google | 按次，企业向 | 是 | 已有云账号时顺手 |

**推荐自建 SearXNG**：本系统本来就有受限全文抓取（`research-fetch.js`，含 SSRF 逐跳复查、
体积/超时上限），检索只负责"找 URL"，抓取我们自己控。
唯一成本是一台 1C2G 的机器，且能按 `websearch.research.allowedHosts` 锁定官方域名。

⚠ 注意：SearXNG 自身**没有鉴权**，`searxng` 模式下 `needsKey=false`。
生产部署时它必须只监听内网、且系统的端点校验会拒绝内网地址——**这里存在一个规划冲突**：
若 SearXNG 跑在 `127.0.0.1` / 内网 IP，出站校验会拦。
解决办法是给它一个**可解析的公网域名 + https**（Nginx 反代 + 基本认证），或走
`MOS_EGRESS_ALLOW_LOOPBACK=1` 的显式豁免（仅限同机部署，且必须在文档里登记）。
这一项**需要在部署时定方案，不是配错**。

---

## 5. 推荐组合（三选一）

### 组合一：国产全栈（推荐，最省事）

| 能力 | 供应商 | 端点 | 模型 |
| --- | --- | --- | --- |
| 文本 | `deepseek` | `https://api.deepseek.com/v1` | `deepseek-v4-pro` |
| 图像 | `openai` | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seedream-5-0-lite-260128` |
| 视频 | `volcengine`（0.1.5 已支持） | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seedance-2-0-mini` |
| 检索 | `searxng` | 自建域名 | — |

月成本量级：文本 ≈ 40 元 + 图像（200 张）≈ 44 元 + 视频（30 条 × 5 秒 720P）≈ 27 元 ≈ **110 元/月**。
优势：一个账号（火山）覆盖图像+视频，一个账号（DeepSeek）覆盖文本，数据不出境。

### 组合二：双语质量优先

| 能力 | 供应商 | 模型 |
| --- | --- | --- |
| 文本（中文） | `deepseek` | `deepseek-v4-pro` |
| 文本（英文文案） | `anthropic` | `claude-sonnet-5` ← 需要时在页面切换 |
| 图像 / 视频 | 同组合一 | — |

月成本量级：≈ 40 + 30（英文文案部分）+ 44 + 27 ≈ **140 元/月**。

### 组合三：国际旗舰

文本 `gpt-6-sol` 或 `claude-opus-5`，图像 `gpt-image-2.5-sunburst`，检索 `tavily`。
质量上限最高，但需解决**数据出境合规**与**网络可达性**两件事，月成本 300 元起。
除非已有跨境合规结论，否则不建议作为第一版。

---

## 6. 接入前的合规自查（这三条比选型更重要）

1. **数据分级先定**：系统会把外发内容分成 `PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED`，
   取"你声明"与"系统检测"中更严的一档。
   - 客户名单、未公开报价、身份证/银行卡/手机号会被正则识别，命中即需显式开关才放行。
   - **默认 `allowConfidential=false`、`allowRestricted=false`**，这是对的，不要为了跑通就打开。
2. **境外供应商需单独审批**：OpenAI / Anthropic 属数据出境。若选组合三，先走合规，再填 Key。
3. **密钥注入方式**：生产必须用 `MOS_SECRET_KEY` 环境变量注入主密钥（不要依赖 `data/.mos-secret.key`），
   否则换机/重装后旧密文全部报 `SECRET_KEY_MISMATCH`。

---

## 7. 两个我没有替你做的决定

1. **是否做"按任务路由"**：现在 `text` 只能配一个供应商。
   若你要"报告用 DeepSeek、英文文案用 Claude"自动切换，需要在 `provideradmin` 里把
   `text` 从单配置改成"按 task 映射"，并给账本加 `task` 维度统计——约 150 行 + 测试。
2. ~~**视频改造**~~：**已完成**（0.1.5，§3.4）。剩下的是你去填 Key 与模型名。

---

## 8. 价格来源

| 项 | 来源 |
| --- | --- |
| DeepSeek 模型名与峰谷价 | DeepSeek API Docs《模型 & 价格》《首次调用 API》（api-docs.deepseek.com，2026-10 核实） |
| Qwen3.8 系列价格 | 阿里云百炼定价页 / 阿里云开发者社区定价解读（2026-09 更新） |
| Claude 价格 | Anthropic 官方 Plans & Pricing（Opus 5 / Sonnet 5 / Haiku 4.5） |
| OpenAI 价格 | OpenAI 官方 Pricing 页（gpt-6-astra / sol / luna；gpt-image-2 / 2.5） |
| Seedream 图像价格 | 火山方舟《模型价格》（0.22 / 0.25 / 0.30 / 0.60 元每张） |
| Seedance 视频价格 | 火山引擎套餐说明中的折算单价（元/秒） |
| Sora 2 关停 | OpenAI deprecations 页 + 多家独立报道（2026-09-24 移除，无继任） |
