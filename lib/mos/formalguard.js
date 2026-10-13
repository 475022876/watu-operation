'use strict';
/**
 * 正式输出门禁（V1.2 / B1）—— 「失效对象不得继续生成新正式作品」的唯一权威判定。
 *
 * 依据 V1.2 B 包 B1 原文：
 *   「Revoked / Deprecated / 权限撤销 / Skill 失效**不得继续生成新正式作品**。」
 * 依据 C 包「唯一权威契约」：
 *   「复用前验证权限及有效版本。」
 *
 * 为什么单独成模块（而不是塞进 routes/creative.js）：
 *   · 同一规则需要被**多条入口**复用（图像生成、文字生成、内容版本冻结、提示词预览）；
 *     写在路由里必然出现「一处修好、另一处漏掉」的漂移；
 *   · 门禁判定必须与 `admissionlib.reuseEligibility()`、`skill.usability()` 保持**同源**，
 *     绝不在门禁里重复实现一套「可复用」判断（重复实现 = 迟早不一致）。
 *
 * 判定口径（三条），任一不满足即**阻断正式输出**：
 *   1. `SKILL_NOT_EFFECTIVE`      —— 正式输出必须落在**已批准生效**的品牌 Skill 上；
 *      未登记 / PENDING_APPROVAL / REFERENCE_ONLY 一律不可正式使用
 *      （REFERENCE_ONLY 只允许测试草稿，见 skill.js usability）。
 *   2. `BRIEF_NOT_READY`          —— 关联 Campaign 的 Marketing Brief 存在未核验宣称/引用时，
 *      `readyForOfficialUse=false`，不得进入正式输出。
 *   3. `LIBRARY_REF_NOT_REUSABLE` —— 引用的资料库资产当前**不可复用**
 *      （已撤回 / 已废止 / 权限撤销 / 非 ACTIVE / 权限未核验通过）。
 *   4. `LIBRARY_REF_INVALIDATED`  —— 该引用已被事件消费登记为本地失效
 *      （`library_invalidations`，含 `asset.revoked` / `asset.not_found` 等）。
 *
 * 诚实性边界：
 *   · 本模块**只做判定**，不代替 Provider 的权威结论；正式可用性的最终事实来源始终是
 *     企业资料库（Provider），本侧判定只是「在出站之前就拦住明显不该发的请求」。
 *   · `advisories` 用于**非正式输出**（TEST_DRAFT）的提示：它不阻断，但如实告知
 *     「你所引用的资产已失效」，避免操作者误以为草稿可以对外。
 */

const admissionlib = require('./admissionlib');
const skill = require('./skill');

/** 阻断码（稳定枚举，供 API / UI / 测试断言） */
const FORMAL_BLOCK_CODES = {
  SKILL_NOT_EFFECTIVE: 'SKILL_NOT_EFFECTIVE',
  BRIEF_NOT_READY: 'BRIEF_NOT_READY',
  LIBRARY_REF_NOT_REUSABLE: 'LIBRARY_REF_NOT_REUSABLE',
  LIBRARY_REF_INVALIDATED: 'LIBRARY_REF_INVALIDATED',
  LIBRARY_REF_NOT_FOUND: 'LIBRARY_REF_NOT_FOUND'
};

/** 该本地失效类型是否意味着「不可再复用」 */
const BLOCKING_INVALIDATION_KINDS = ['asset.revoked', 'asset.deprecated', 'asset.not_found',
  'skill.version.changed', 'permission.changed'];

/* ==================== 解析：任务 → brief / 引用 ==================== */

/** 关联 Campaign 的 Marketing Brief（任务级 → Campaign 级） */
function briefOf(db, task) {
  if (!task) return null;
  const campaignId = task.campaignId || '';
  if (!campaignId) return null;
  const c = (db.campaigns || []).find((x) => x.id === campaignId) || null;
  return c ? (c.marketingBrief || null) : null;
}

/** 从 brief 的 productRefs / productClaims 中挑出 LIBRARY 类引用 id */
function libraryRefIdsFromBrief(brief) {
  const out = [];
  if (!brief) return out;
  const push = (kind, id) => {
    if (String(kind || '').toUpperCase() !== 'LIBRARY') return;
    const v = String(id || '').trim();
    if (v && out.indexOf(v) === -1) out.push(v);
  };
  for (const r of (brief.productRefs || [])) push(r && r.sourceKind, r && r.refId);
  for (const c of (brief.productClaims || [])) push(c && c.sourceKind, c && c.sourceRef);
  return out;
}

/** 汇总本次要校验的引用 id 集合（显式入参 + 任务字段 + brief） */
function collectRefIds(db, input) {
  const ids = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (s && ids.indexOf(s) === -1) ids.push(s);
  };
  for (const x of (input.libraryRefIds || [])) add(x);
  const task = input.task || null;
  if (task) for (const x of (task.libraryRefIds || [])) add(x);
  for (const x of libraryRefIdsFromBrief(input.brief || briefOf(db, task))) add(x);
  return ids;
}

/** 解析一条引用：既接受 library_asset_refs.id，也接受资料库侧 libraryAssetId */
function resolveRef(db, id) {
  const key = String(id || '');
  if (!key) return null;
  return (db.library_asset_refs || []).find((r) => r.id === key || r.libraryId === key) || null;
}

/* ==================== 判定 ==================== */

/**
 * 评估一次输出请求能否进入**正式输出**。
 *
 * @param {object} db
 * @param {object} input
 *   - `brandCode`    品牌
 *   - `task`         内容任务（可选；用于取 campaignId → brief）
 *   - `brief`        直接给 Marketing Brief（可选，优先于任务解析）
 *   - `skillCode`    Skill 代码（可选）
 *   - `outputIntent` 输出意图原始值（由 skill.normalizeIntent 归一化）
 *   - `libraryRefIds` 显式引用 id 列表（可选）
 * @returns {{
 *   intent:('FORMAL'|'TEST_DRAFT'|null), formal:boolean, allowed:boolean,
 *   blockers:Array, advisories:Array,
 *   detail:{ skill:object, refs:Array, briefReady:(boolean|null) }
 * }}
 */
function evaluate(db, input) {
  const o = input || {};
  const intent = skill.normalizeIntent(o.outputIntent);
  const formal = intent === 'FORMAL';

  const blockers = [];
  const advisories = [];

  /* ---- 1. Skill 生效状态 ---- */
  const sk = skill.resolveSkill(db, o.brandCode, o.skillCode);
  if (formal && !sk.formalUsable) {
    blockers.push({
      code: FORMAL_BLOCK_CODES.SKILL_NOT_EFFECTIVE,
      note: '正式输出需落在已批准生效的品牌 Skill 上；当前状态 ' + sk.state + '。' + (sk.note || ''),
      skillState: sk.state
    });
  } else if (!formal && !sk.formalUsable) {
    advisories.push({
      code: FORMAL_BLOCK_CODES.SKILL_NOT_EFFECTIVE,
      note: '当前 Skill 状态 ' + sk.state + '：仅可产出明确标注的测试草稿，不得对外作为正式品牌输出。'
    });
  }

  /* ---- 2. Marketing Brief 就绪 ---- */
  const brief = o.brief || briefOf(db, o.task);
  let briefReady = null;
  if (brief) {
    briefReady = brief.readyForOfficialUse !== false;
    if (formal && !briefReady) {
      blockers.push({
        code: FORMAL_BLOCK_CODES.BRIEF_NOT_READY,
        note: 'Marketing Brief 存在未核验的宣称/引用（claimSummary.unverified='
          + ((brief.claimSummary || {}).unverified || 0) + '），不得进入正式输出。',
        detail: (brief.productClaims || []).filter((c) => c.verification !== 'VERIFIED')
          .map((c) => ({ text: String(c.text || '').slice(0, 120), reason: c.reason }))
      });
    }
  }

  /* ---- 3. 资料库引用可复用性 + 本地失效登记 ---- */
  const refIds = collectRefIds(db, Object.assign({}, o, { brief }));
  const refDetail = [];
  for (const id of refIds) {
    const ref = resolveRef(db, id);
    if (!ref) {
      refDetail.push({ refId: id, found: false, reusable: false });
      if (formal) {
        blockers.push({
          code: FORMAL_BLOCK_CODES.LIBRARY_REF_NOT_FOUND,
          note: '引用的资料库条目不存在或未被本侧登记：' + id,
          refId: id
        });
      }
      continue;
    }
    const adm = (db.asset_admissions || []).find((x) => x.id === ref.admissionId) || null;
    const elig = admissionlib.reuseEligibility(adm, ref);

    const invRows = (db.library_invalidations || []).filter((v) =>
      String(v.targetId || '') === String(ref.libraryId || '')
      || String(v.targetId || '') === String(ref.id || ''));
    const inv = invRows.filter((v) => BLOCKING_INVALIDATION_KINDS.indexOf(String(v.kind || '')) !== -1);

    refDetail.push({
      refId: ref.id, libraryId: ref.libraryId || null, found: true,
      reusable: elig.eligible, blocking: elig.blocking,
      permissionValid: !!ref.permissionValid, assetState: ref.assetState || null,
      invalidated: inv.length > 0, invalidationKinds: inv.map((v) => v.kind),
      mock: !!ref.mock
    });

    if (formal && inv.length > 0) {
      blockers.push({
        code: FORMAL_BLOCK_CODES.LIBRARY_REF_INVALIDATED,
        note: '引用的资料库条目已被登记为失效（' + inv.map((v) => v.kind).join('、')
          + '），不得继续生成新正式作品。',
        refId: ref.id, libraryId: ref.libraryId || null
      });
    }
    if (formal && !elig.eligible) {
      blockers.push({
        code: FORMAL_BLOCK_CODES.LIBRARY_REF_NOT_REUSABLE,
        note: '引用的资料库条目不可复用：' + ((elig.blocking || []).join('；') || '未通过复用资格判定'),
        refId: ref.id, libraryId: ref.libraryId || null
      });
    }
    if (!formal && (!elig.eligible || inv.length > 0)) {
      advisories.push({
        code: inv.length > 0 ? FORMAL_BLOCK_CODES.LIBRARY_REF_INVALIDATED
          : FORMAL_BLOCK_CODES.LIBRARY_REF_NOT_REUSABLE,
        note: '所引用的资料库条目当前不可复用（' + ((elig.blocking || []).join('；') || '已失效')
          + '）：测试草稿不得对外发布。',
        refId: ref.id
      });
    }
  }

  return {
    intent,
    formal: !!formal,
    allowed: formal ? blockers.length === 0 : true,
    blockers,
    advisories,
    detail: { skill: sk, refs: refDetail, briefReady }
  };
}

module.exports = {
  FORMAL_BLOCK_CODES,
  BLOCKING_INVALIDATION_KINDS,
  briefOf,
  libraryRefIdsFromBrief,
  collectRefIds,
  resolveRef,
  evaluate
};
