'use strict';
/**
 * V0.1.2 Phase B —— Web Research Provider 适配层（执行包 02 §双来源引擎 B）。
 *
 * 诚实性红线：
 *  - 当前**没有**任何已授权的搜索 Provider 凭据 → `search()` 一律返回 BLOCKED/NOT_CONFIGURED，
 *    绝不伪造搜索结果；接口按真实 Provider 形状设计，配置凭据后即可接入真实实现；
 *  - LLM 不能以参数或旧知识伪称「今日研究」——Web Research 报告必须有真实搜索获取，
 *    否则整体 BLOCKED（02 §B / §风险）。
 *
 * 安全边界（对所有外部抓取生效，含未来真实 Provider）：
 *  - 仅 https；拒绝内网/环回/链路本地/私有地址（SSRF + DNS 重绑定防护的字面校验层，
 *    真实实现还须在连接期做 IP 复核）；拒绝非 http(s) 协议与可疑端口；限制重定向由真实实现处理。
 */

const PROVIDERS = {
  none: { label: '未配置', configured: false }
};

function providerStatus() {
  const name = String(process.env.MOS_WEBSEARCH_PROVIDER || 'none').trim().toLowerCase() || 'none';
  const def = PROVIDERS[name] || { label: name, configured: Boolean(process.env.MOS_WEBSEARCH_API_KEY) };
  const configured = Boolean(def.configured || (name !== 'none' && process.env.MOS_WEBSEARCH_API_KEY));
  return { provider: name, configured, label: def.label, note: configured
    ? '已配置（真实调用须另行授权与费用批准）'
    : '未配置搜索 Provider（MOS_WEBSEARCH_PROVIDER / MOS_WEBSEARCH_API_KEY）：Web 研究保持 BLOCKED，不伪造结果' };
}

function isConfigured() { return providerStatus().configured; }

/** 校验外部 URL 安全性（不可信数据：02 §风险与失败条件）。返回 {ok, reason?} */
function assertSafeUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch (_) { return { ok: false, reason: 'URL 无法解析' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: '仅允许 https（外部抓取）' };
  const host = String(u.hostname || '').toLowerCase();
  if (!host) return { ok: false, reason: '缺少主机名' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || host === 'metadata') return { ok: false, reason: '内网/内部主机名被拒绝' };
  // 字面 IPv4/IPv6 内网段（字面校验层；真实实现还须连接期复核解析 IP）
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const o = host.split('.').map(Number);
    if (o[0] === 0 || o[0] === 10 || o[0] === 127 || (o[0] === 169 && o[1] === 254)
      || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168)
      || (o[0] === 100 && o[1] >= 64 && o[1] <= 127) || o[0] >= 224) {
      return { ok: false, reason: '私有/保留 IP 段被拒绝（SSRF 防护）' };
    }
  }
  if (host.startsWith('[')) return { ok: false, reason: 'IPv6 字面量交由真实 Provider 的连接期校验处理' };
  if (u.port && !['', '443'].includes(String(u.port))) return { ok: false, reason: '仅允许 443 端口' };
  return { ok: true };
}

/**
 * 真实搜索入口。未配置 → BLOCKED（绝无网络请求、绝无伪造结果）。
 * 未来真实实现契约：resolve → assertSafeUrl 每条结果 → 抓取 → SourceEvidence 生成（含内容哈希）。
 */
async function search(req) {
  const st = providerStatus();
  if (!st.configured) {
    return {
      ok: false,
      blocked: true,
      code: 'NOT_CONFIGURED',
      reason: '搜索 Provider 未配置（MOS_WEBSEARCH_PROVIDER / MOS_WEBSEARCH_API_KEY）。'
        + '系统不会以模型参数或旧知识伪称「今日研究」；配置凭据并获授权后本接口才发起真实搜索。',
      provider: st.provider,
      results: [],
      evidence: []
    };
  }
  // 真实 Provider 接入点（凭据 + 授权 + 费用批准后实现）：
  //   1) 调 Provider API；2) 对每条结果 assertSafeUrl；3) 抓取正文（超时/大小/MIME 限制）；
  //   4) 生成 SourceEvidence（contentHash=sha256）；5) 记录成本与审计。
  return { ok: false, blocked: true, code: 'PROVIDER_NOT_IMPLEMENTED',
    reason: '真实 Provider 通道尚未实现（需授权凭据 + 费用批准 + 来源白名单复核）', provider: st.provider, results: [], evidence: [] };
}

module.exports = { providerStatus, isConfigured, assertSafeUrl, search };
