'use strict';
/**
 * ImageProvider —— 图像生成适配器（04 §1/§2/§5）。
 *
 * 三种模式，**必须在 UI/API 明确区分**（不得混为一谈）：
 *   - `none`（默认）：尚未配置模型 → `NOT_CONFIGURED`，不产出任何东西。
 *     UI 必须显示「尚未配置模型」，**不得**用模拟图冒充真实模型结果（01 §4）。
 *   - `mock`：沙盒演示用。产出一张**真实落盘的 SVG 文件**，图上带醒目
 *     「MOCK · 非真实模型输出」标记与提示词摘要 —— 既满足「生成图像要真实保存产出」，
 *     也满足「明确显示模拟」（09 §3）。
 *   - `openai`：真实云端图片 API（OpenAI 兼容 `/v1/images/generations`）。
 *     密钥**只在服务端**（config.json → mos.image.apiKey 或环境变量 MOS_IMAGE_API_KEY），
 *     绝不下发浏览器、绝不写入日志或导出物（06 §5 / SEC-07）。
 *     未配置密钥时返回 `NOT_CONFIGURED`，**不伪造**任何输出。
 *
 * 诚实性：本模块**不声称**已对任何真实供应商做过生产级验证；`openai` 分支的可用性
 * 取决于实际密钥与账号配额，未验证前一律以 NOT_CONFIGURED / 失败原样上报。
 */
const { getMosConfig } = require('../config');
const { sha256 } = require('../ids');
const pc = require('../providercontract');

const PROVIDER_ID = 'mos.image';

/** 统一收敛：补齐契约字段（errorCode / retryable / costReceipt / rateLimit），其余字段零改动 */
function decorate(res, extra) {
  const r = Object.assign({}, res);
  const e = extra || {};
  r.errorCode = e.errorCode || r.errorCode || '';
  r.retryable = r.errorCode ? pc.isRetryable(r.errorCode) : false;
  r.rateLimit = e.rateLimit || r.rateLimit || pc.parseRateLimit(null);
  r.costReceipt = e.costReceipt || r.costReceipt || pc.costReceipt(null);
  if (!r.rawStatus) r.rawStatus = e.rawStatus || '';
  return r;
}

/** 转义：生成 SVG 时把外部文本一律当数据（防注入） */
function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 确定性 MOCK 图像：同一提示词 → 完全相同的字节（可复现、可校验）。
 * 背景刻意使用中性白（Neutral Architectural White），避免留白色偏（07 §2）。
 */
function mockSvg(req) {
  const h = sha256(req.prompt || '');
  const seed = parseInt(h.slice(0, 8), 16);
  const w = req.width || 1200;
  const ht = req.height || 800;
  const promptLines = String(req.prompt || '（空提示词）').split('\n').slice(0, 14);

  // 由 seed 派生的确定性几何：只用于证明"这张图确实由本次请求生成"
  const band = [];
  for (let i = 0; i < 6; i += 1) {
    const x = (seed >> (i * 2)) % (w - 160);
    const bw = 40 + ((seed >> (i * 3)) % 160);
    band.push('<rect x="' + x + '" y="' + Math.round(ht * 0.55 + i * 26) + '" width="' + bw
      + '" height="8" fill="#071D49" opacity="0.10"/>');
  }

  const text = promptLines.map((l, i) =>
    '<text x="64" y="' + (300 + i * 22) + '" font-family="monospace" font-size="15" fill="#0C2E69">'
    + esc(l.slice(0, 96)) + '</text>').join('');

  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + ht + '" viewBox="0 0 ' + w + ' ' + ht + '" role="img" aria-label="MOCK 生成图（非真实模型输出）">\n'
    + '  <rect width="' + w + '" height="' + ht + '" fill="#FCFBF7"/>\n'
    + '  <rect x="0" y="0" width="' + w + '" height="' + ht + '" fill="none" stroke="#E6D8BD" stroke-width="2"/>\n'
    + '  <rect x="0" y="0" width="' + w + '" height="56" fill="#071D49"/>\n'
    + '  <text x="24" y="36" font-family="sans-serif" font-size="20" font-weight="700" fill="#FFFFFF">MOCK 生成图 · 非真实模型输出</text>\n'
    + '  <text x="' + (w - 300) + '" y="36" font-family="monospace" font-size="14" fill="#C78B27">rule ' + h.slice(0, 12) + '</text>\n'
    + '  <text x="64" y="120" font-family="sans-serif" font-size="26" font-weight="700" fill="#071D49">'
    + esc(req.title || '无标题') + '</text>\n'
    + '  <text x="64" y="158" font-family="sans-serif" font-size="16" fill="#0C2E69">'
    + esc((req.brandName || req.brandCode || '') + ' · ' + (req.platform || '') + ' · ' + (req.aspect || ''))
    + ' · skill=' + esc(req.skillState || '—') + '</text>\n'
    + '  <text x="64" y="196" font-family="sans-serif" font-size="14" fill="#A9670C">本图为沙盒模拟产物：不含任何真实模型能力，不可用于对外发布。</text>\n'
    + '  <rect x="32" y="236" width="' + (w - 64) + '" height="' + (ht - 320) + '" fill="#FFFFFF" stroke="#E6D8BD"/>\n'
    + '  <text x="64" y="272" font-family="sans-serif" font-size="14" font-weight="700" fill="#071D49">提示词快照（resolved prompt）</text>\n'
    + text
    + '  <g>' + band.join('') + '</g>\n'
    + '  <text x="64" y="' + (ht - 48) + '" font-family="monospace" font-size="13" fill="#0C2E69">prompt-sha256 '
    + h + '</text>\n'
    + '  <text x="64" y="' + (ht - 24) + '" font-family="sans-serif" font-size="13" fill="#0C2E69">effective_rule_hash '
    + esc(req.effectiveRuleHash || '—') + ' · QA 仅供参考，合格仍需人工判断</text>\n'
    + '</svg>\n', 'utf8');
}

function status() {
  const cfg = getMosConfig();
  const mode = String(cfg.integrations.imageProvider || 'none').toLowerCase();
  const key = (cfg.image && cfg.image.apiKey) || process.env.MOS_IMAGE_API_KEY || '';
  /* V0.1.3 Phase C：就绪度（执行包 06 §真实Provider判定）——升级过程不得把 BLOCKED 隐去。
   * 语义：MOCK 是本地模拟，**不是**真实模型能力，因此 readiness 仍为 NOT_CONFIGURED。 */
  let readiness = 'NOT_CONFIGURED';
  if (mode === 'openai') readiness = key ? 'CONFIGURED_NOT_TESTED' : 'NOT_CONFIGURED';
  else if (mode === 'mock') readiness = 'NOT_CONFIGURED';
  else if (mode !== 'none' && mode) readiness = 'NOT_IMPLEMENTED';
  return {
    provider: PROVIDER_ID,
    mode,
    configured: mode !== 'none' && (mode !== 'openai' || !!key),
    readiness,
    simulated: mode === 'mock',
    hasServerKey: !!key,
    mock: mode === 'mock',
    timeoutMs: (cfg.image && cfg.image.timeoutMs) || 60000,
    note: mode === 'mock'
      ? 'MOCK 图像：产出确定性 SVG 并标注「非真实模型输出」，仅用于演示流程；就绪度仍为 NOT_CONFIGURED。'
      : (mode === 'openai'
        ? (key ? '已配置服务端密钥（密钥不下发浏览器）。实际可用性取决于账号配额，未验证前不声称可生产使用。'
          : '已选择 openai 但**未配置服务端密钥** → 返回 NOT_CONFIGURED，不生成任何内容。')
        : '尚未配置图像模型（01 §4：UI 必须显示「尚未配置模型」）。')
  };
}

/**
 * 视频 Provider 就绪声明（执行包 03 §视频）。
 * 本轮**不新增全 AI 长视频引擎**：视频交付物在任务内以「脚本 / 分镜 / 旁白字幕 / 关键帧 /
 * 素材上传 / 成品上传」的手工流程维护，AI 成片能力明确记为 NOT_IMPLEMENTED，
 * 因此**不宣称任何「AI 生成成片」**。
 */
function videoStatus() {
  return {
    provider: 'mos.video',
    mode: 'not_implemented',
    configured: false,
    readiness: 'NOT_IMPLEMENTED',
    manualWorkflow: true,
    capabilities: ['SCRIPT', 'STORYBOARD', 'KEYFRAME', 'ASSET_UPLOAD', 'FINAL_CUT_UPLOAD'],
    note: 'AI 成片未实现（NOT_IMPLEMENTED）：任务内提供脚本/分镜/关键帧/上传等手工流程，'
      + '不含任何自动化视频渲染；UI 不出现「AI 生成视频」按钮。'
  };
}

/** 契约：可用性探针（离线；不主动发起真实探测以避免付费调用） */
async function health() {
  return pc.healthOf(pc.providerConfig('image'), { supportsLiveProbe: false });
}

/**
 * 生成图像。
 * @param {object} req { prompt, title, brandCode, brandName, platform, aspect, width, height,
 *                       skillState, effectiveRuleHash }
 * @returns {Promise<{state:string, mock:boolean, outputs:Array, usage:object, billing:object, rawStatus:string, note?:string}>}
 */
async function generate(req) {
  const cfg = getMosConfig();
  const mode = String(cfg.integrations.imageProvider || 'none').toLowerCase();
  const r = req || {};

  if (mode === 'none' || !mode) {
    return decorate({
      state: 'NOT_CONFIGURED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
      note: '尚未配置图像模型：不生成任何图片。请在 config.json 配置 mos.integrations.imageProvider。'
    }, { errorCode: pc.ERROR_CODES.NOT_CONFIGURED, rawStatus: 'NOT_CONFIGURED' });
  }

  if (mode === 'mock') {
    const buf = mockSvg(r);
    return decorate({
      state: 'MOCK', mock: true,
      outputs: [{ mime: 'image/svg+xml', ext: '.svg', bytes: buf, width: r.width || 1200, height: r.height || 800 }],
      usage: { note: 'MOCK：无真实供应商调用', promptSha256: sha256(r.prompt || '') },
      billing: { amount: 0, currency: 'USD', confirmed: true },
      note: '沙盒模拟产物：图上已标注「非真实模型输出」，不得用于对外发布。'
    }, { rawStatus: 'MOCK_OK', costReceipt: { amount: 0, currency: 'USD', confirmed: true, source: 'mock-local' } });
  }

  if (mode === 'openai') {
    const p = pc.providerConfig('image');
    if (!p.hasServerKey) {
      return decorate({
        state: 'NOT_CONFIGURED', mock: false, outputs: [], usage: {},
        billing: { amount: 0, currency: 'USD' },
        note: '已选择真实图像供应商但未配置服务端密钥 → 不生成任何内容（绝不伪造输出）。'
      }, { errorCode: pc.ERROR_CODES.NOT_CONFIGURED, rawStatus: 'NOT_CONFIGURED' });
    }
    const base = p.baseUrl || 'https://api.openai.com/v1';
    const model = p.model || 'gpt-image-1';
    try {
      const res = await pc.fetchWithTimeout(base.replace(/\/$/, '') + '/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.apiKey },
        body: JSON.stringify({ model, prompt: String(r.prompt || '').slice(0, 4000), size: r.size || '1024x1024', n: 1 })
      }, p.timeoutMs);
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* ignore */ }
      const rateLimit = pc.parseRateLimit(res.headers);
      if (!res.ok) {
        return decorate({
          state: 'FAILED', mock: false, outputs: [], usage: {},
          billing: { amount: 0, currency: 'USD' },
          note: '供应商返回失败：' + String((json && (json.error && json.error.message)) || text).slice(0, 300)
        }, { errorCode: pc.classifyHttp(res.status), rateLimit, rawStatus: 'HTTP_' + res.status });
      }
      const item = json && json.data && json.data[0];
      if (!item || !item.b64_json) {
        return decorate({
          state: 'FAILED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
          note: '供应商未返回可解析的图像内容。'
        }, { errorCode: pc.ERROR_CODES.EMPTY_RESPONSE, rateLimit, rawStatus: 'EMPTY_RESPONSE' });
      }
      const usage = json.usage || {};
      return decorate({
        state: 'SUCCEEDED', mock: false,
        outputs: [{ mime: 'image/png', ext: '.png', bytes: Buffer.from(item.b64_json, 'base64') }],
        usage: { providerJobId: json.id || '', raw: usage },
        // 费用只记录供应商**实际回执**；无回执一律 null（不凭空推算，04 §5）
        billing: { amount: null, currency: '', confirmed: false },
        note: '真实供应商返回成功；费用以供应商账单为准（本系统不做换汇推算）。'
      }, { rateLimit, costReceipt: pc.costReceipt(json), rawStatus: 'HTTP_200' });
    } catch (err) {
      const code = pc.classifyError(err);
      return decorate({
        state: 'FAILED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
        note: (code === pc.ERROR_CODES.TIMEOUT ? '调用供应商超时（' + p.timeoutMs + 'ms）' : '调用供应商失败：' )
          + String(err && err.message).slice(0, 200)
      }, { errorCode: code, rawStatus: code });
    }
  }

  return decorate({
    state: 'NOT_CONFIGURED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
    note: '未知的 imageProvider 配置：' + mode
  }, { errorCode: pc.ERROR_CODES.UNKNOWN_MODE, rawStatus: 'UNKNOWN_MODE' });
}

/** 契约：统一调用入口（04 §6 `invoke`）；未知 op 明确报错，不做静默降级 */
async function invoke(req) {
  const r = req || {};
  const op = String(r.op || 'generate').toLowerCase();
  if (op === 'generate') return generate(r);
  return decorate({ state: 'FAILED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
    note: '未知的 invoke.op：' + op + '（支持 generate）' },
  { errorCode: pc.ERROR_CODES.UNKNOWN_MODE, rawStatus: 'UNKNOWN_OP' });
}

/** 能力声明（04 §1 capabilities 契约） */
function capabilities() {
  const cfg = getMosConfig();
  const mode = String(cfg.integrations.imageProvider || 'none').toLowerCase();
  return {
    generate: mode !== 'none',
    edit: false,
    references: false,
    sizes: ['1:1', '4:5', '16:9', '9:16'],
    mode
  };
}

module.exports = { PROVIDER_ID, status, videoStatus, health, generate, invoke, capabilities, mockSvg };
