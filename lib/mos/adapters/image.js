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
const provideradmin = require('../provideradmin');
const providerlog = require('../providerlog');
const egress = require('../egress');

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
  const e = provideradmin.effective('image');
  const mode = e.mode;
  const key = e.apiKey;
  /* 就绪度统一由 provideradmin 判定（有真实成功调用证据才可能为 REAL）：
   * MOCK 是本地模拟，**不是**真实模型能力，因此 readiness 仍为 NOT_CONFIGURED。 */
  const rd = provideradmin.readinessOf('image');
  return {
    provider: PROVIDER_ID,
    mode,
    model: e.model,
    configured: mode !== 'none' && (rd.readiness === 'REAL' || rd.readiness === 'CONFIGURED_NOT_TESTED'),
    readiness: rd.readiness,
    readinessReason: rd.reason,
    simulated: mode === 'mock',
    hasServerKey: !!key,
    mock: mode === 'mock',
    timeoutMs: e.timeoutMs,
    maxRetries: e.maxRetries,
    note: rd.reason
  };
}

/**
 * 尺寸映射：把业务侧的比例（1:1 / 4:5 / 16:9 / 9:16）映射为供应商接受的像素尺寸。
 * 业务侧不暴露"像素/采样步数"这类技术参数（01 §UI 减法），映射在服务端完成。
 */
const ASPECT_SIZE = {
  '1:1': '1024x1024',
  '4:5': '1024x1536',
  '3:4': '1024x1536',
  '16:9': '1536x1024',
  '9:16': '1024x1536'
};

function imageSizeOf(r) {
  const req = r || {};
  const explicit = String(req.size || '').trim();
  if (/^\d{3,4}x\d{3,4}$/.test(explicit)) return explicit;
  const aspect = String(req.aspect || '').trim();
  if (ASPECT_SIZE[aspect]) return ASPECT_SIZE[aspect];
  /* 有宽高但没写尺寸：按比例就近归类 */
  const w = Number(req.width) || 0;
  const h = Number(req.height) || 0;
  if (w && h) {
    const ratio = w / h;
    if (ratio > 1.2) return ASPECT_SIZE['16:9'];
    if (ratio < 0.85) return ASPECT_SIZE['9:16'];
  }
  return '1024x1024';
}

/**
 * 视频 Provider 就绪声明（保留旧导出名，实现已迁移到 `adapters/video.js`）。
 * 视频交付物仍以「脚本 / 分镜 / 旁白字幕 / 关键帧 / 素材上传 / 成品上传」的手工流程为主；
 * 配置了真实供应商时才额外声明 `AI_RENDER` 能力，未配置时**绝不出现**"AI 生成视频"入口。
 */
function videoStatus() {
  return require('./video').status();
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
  const eff = provideradmin.effective('image');
  const mode = eff.mode;
  const r = req || {};

  if (mode === 'none' || !mode) {
    return decorate({
      state: 'NOT_CONFIGURED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
      note: '尚未配置图像模型：不生成任何图片。请管理员在「系统接入」页选择供应商并填写密钥。'
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

  if (mode === 'openai' || mode === 'zhipu') {
    const p = pc.providerConfig('image');
    if (!p.hasServerKey) {
      return decorate({
        state: 'NOT_CONFIGURED', mock: false, outputs: [], usage: {},
        billing: { amount: 0, currency: 'USD' },
        note: '已选择真实图像供应商但未配置服务端密钥 → 不生成任何内容（绝不伪造输出）。'
      }, { errorCode: pc.ERROR_CODES.NOT_CONFIGURED, rawStatus: 'NOT_CONFIGURED' });
    }

    const prompt = String(r.prompt || '').slice(0, 4000);
    if (!prompt.trim()) {
      return decorate({ state: 'FAILED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
        note: '缺少画面描述（prompt）' }, { errorCode: pc.ERROR_CODES.BAD_REQUEST, rawStatus: 'BAD_REQUEST' });
    }

    /* 1. 数据分级闸门（机密/受限默认零出站） */
    const cls = egress.classify(prompt + '\n' + String(r.title || ''), r.dataClass);
    try {
      egress.assertDataPolicy(cls, egress.dataPolicy(provideradmin.policy()));
    } catch (err) {
      providerlog.record({
        kind: 'image', op: 'generate', provider: mode, model: p.model, state: 'BLOCKED',
        errorCode: pc.ERROR_CODES.BLOCKED_DATA_CLASS, actorId: r.actorId, brandCode: r.brandCode,
        dataClass: cls.dataClass,
        note: 'kf=' + p.keyFingerprint + ' ' + err.code + ' ' + cls.reasons.join(',')
      });
      return decorate({
        state: 'BLOCKED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
        note: '画面描述被判定为' + (cls.dataClass === 'RESTRICTED' ? '受限' : '机密') + '数据，默认禁止外发图像模型'
          + '（命中：' + (cls.reasons.join('、') || '显式声明') + '）。'
      }, { errorCode: pc.ERROR_CODES.BLOCKED_DATA_CLASS, rawStatus: 'BLOCKED' });
    }

    /* 2. 预算预检（超出上限则不发请求） */
    const estimate = provideradmin.estimateCost('image', { promptChars: prompt.length, completionTokens: 0 });
    const budgetCheck = provideradmin.checkBudget({ kind: 'image', estimateUsd: estimate, brandCode: r.brandCode });
    if (!budgetCheck.ok) {
      providerlog.record({
        kind: 'image', op: 'generate', provider: mode, model: p.model, state: 'BLOCKED',
        errorCode: pc.ERROR_CODES.BUDGET_EXCEEDED, actorId: r.actorId, brandCode: r.brandCode,
        dataClass: cls.dataClass, note: 'kf=' + p.keyFingerprint + ' ' + budgetCheck.note
      });
      return decorate({ state: 'BLOCKED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
        note: budgetCheck.note }, { errorCode: pc.ERROR_CODES.BUDGET_EXCEEDED, rawStatus: 'BLOCKED' });
    }

    /* 3. 端点安全 */
    const base = String(p.baseUrl || (mode === 'zhipu'
      ? 'https://open.bigmodel.cn/api/paas/v4' : 'https://api.openai.com/v1')).replace(/\/+$/, '');
    const model = p.model || (mode === 'zhipu' ? 'cogview-3-flash' : 'gpt-image-1');
    const url = base + '/images/generations';
    try { await egress.assertProviderUrl(url); } catch (err) {
      return decorate({ state: 'BLOCKED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
        note: '端点未通过出站校验：' + String(err.message || err) },
      { errorCode: 'PROVIDER_EGRESS_BLOCKED', rawStatus: 'BLOCKED' });
    }

    const t0 = Date.now();
    /* 4. 有界重试 */
    const result = await pc.withRetry(async (attempt) => {
      try {
        const res = await pc.fetchWithTimeout(url, {
          method: 'POST', maxResponseBytes: 32 * 1024 * 1024,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.apiKey },
          body: JSON.stringify({ model, prompt, size: imageSizeOf(r), n: 1 })
        }, p.timeoutMs);
        const raw = await res.text();
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { /* ignore */ }
        const rateLimit = pc.parseRateLimit(res.headers);
        if (!res.ok) {
          return decorate({
            state: 'FAILED', mock: false, outputs: [], usage: {},
            billing: { amount: 0, currency: 'USD' },
            note: '供应商返回失败（HTTP ' + res.status + '）：'
              + '上游错误正文已隐藏'
          }, { errorCode: pc.classifyHttp(res.status), rateLimit, rawStatus: 'HTTP_' + res.status });
        }

        const item = json && json.data && json.data[0];
        if (!item) {
          return decorate({
            state: 'FAILED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
            note: '供应商未返回图像内容（响应前 200 字：' + '响应正文已隐藏' + '）'
          }, { errorCode: pc.ERROR_CODES.EMPTY_RESPONSE, rateLimit, rawStatus: 'EMPTY_RESPONSE' });
        }

        /* 两种返回形态都支持：b64_json（默认）与 url（需再取一次，仍走同一出站校验） */
        let bytes = null;
        let mime = 'image/png';
        let ext = '.png';
        if (item.b64_json) {
          bytes = Buffer.from(String(item.b64_json), 'base64');
        } else if (item.url) {
          try {
            await egress.assertProviderUrl(String(item.url));
            const imgRes = await pc.fetchWithTimeout(String(item.url), { method: 'GET', maxResponseBytes: 20 * 1024 * 1024 }, Math.max(p.timeoutMs, 60000));
            if (!imgRes.ok) throw new Error('HTTP ' + imgRes.status);
            const buf = Buffer.from(await imgRes.arrayBuffer());
            if (buf.length > 20 * 1024 * 1024) throw new Error('图像超过 20MB 上限');
            mime = String(imgRes.headers.get('content-type') || 'image/png').split(';')[0];
            ext = /jpeg|jpg/.test(mime) ? '.jpg' : (/webp/.test(mime) ? '.webp' : '.png');
            bytes = buf;
          } catch (err) {
            return decorate({
              state: 'FAILED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
              note: '供应商返回了图片地址但下载失败：' + String((err && err.message) || err).slice(0, 200)
            }, { errorCode: pc.classifyError(err), rateLimit, rawStatus: 'DOWNLOAD_FAILED' });
          }
        }

        if (!bytes || !bytes.length) {
          return decorate({
            state: 'FAILED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
            note: '供应商返回的图像内容为空。'
          }, { errorCode: pc.ERROR_CODES.EMPTY_RESPONSE, rateLimit, rawStatus: 'EMPTY_IMAGE' });
        }

        const receipt = pc.costReceipt(json);
        return decorate({
          state: 'SUCCEEDED', mock: false,
          outputs: [{ mime, ext, bytes, width: r.width || null, height: r.height || null }],
          usage: Object.assign({ providerJobId: (json && json.id) || '', raw: json && json.usage }, pc.usageOf(json)),
          billing: {
            amount: receipt.confirmed ? receipt.amount : null,
            currency: receipt.currency || '',
            confirmed: !!receipt.confirmed
          },
          note: '真实供应商返回成功；费用以供应商账单为准（本系统不做换汇推算）。'
        }, { rateLimit, costReceipt: receipt, rawStatus: 'HTTP_200' });
      } catch (err) {
        const code = pc.classifyError(err);
        return decorate({
          state: 'FAILED', mock: false, outputs: [], usage: {}, billing: { amount: 0, currency: 'USD' },
          note: (code === pc.ERROR_CODES.TIMEOUT ? '调用供应商超时（' + p.timeoutMs + 'ms）' : '调用供应商失败：')
            + String((err && err.message) || err).slice(0, 200)
        }, { errorCode: code, rawStatus: code });
      }
    }, { maxRetries: p.maxRetries });

    /* 5. 账本 */
    providerlog.record({
      kind: 'image', op: 'generate', provider: mode, model,
      state: result.state, errorCode: result.errorCode, retryable: result.retryable,
      latencyMs: Date.now() - t0, attempts: result.attempts, usage: result.usage,
      cost: result.costReceipt, actorId: r.actorId, brandCode: r.brandCode,
      requestId: r.jobId, dataClass: cls.dataClass,
      note: 'kf=' + p.keyFingerprint + ' ' + String(result.note || '').slice(0, 160)
    });
    return result;
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
  const e = provideradmin.effective('image');
  return {
    generate: e.mode !== 'none',
    edit: false,
    references: false,
    sizes: ['1:1', '4:5', '16:9', '9:16'],
    mode: e.mode,
    model: e.model,
    readiness: provideradmin.readinessOf('image').readiness
  };
}

module.exports = {
  PROVIDER_ID, status, videoStatus, health, generate, invoke, capabilities, mockSvg,
  imageSizeOf
};
