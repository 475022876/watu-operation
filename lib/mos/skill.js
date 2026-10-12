'use strict';
/**
 * Marketing OS —— Skill Loader 与品牌规则引擎（04 §2）。
 *
 * 边界（不可削弱）：
 *   - `skill_versions` 是**品牌 Skill 生效状态的唯一事实来源**；
 *   - 非 `APPROVED` 的 Skill **不得用于正式品牌输出**（11 检查表）；
 *     但允许生成**明确标注的测试草稿**（TEST_DRAFT），并在产物上打 MOCK/未批准标记；
 *   - U CARD 的独立 Skill 未批准时**不得套用** VFIB 的设计规则（00 §1）；
 *   - 正式 Logo **不由 AI 重绘**（04 §2）——提示词中作为硬性负向约束注入。
 *
 * 「仅有原始 Markdown 并不会自动约束所有图像模型，应由中台显式生成每家 Provider 适用的请求」（04 §2）
 * —— 因此提示词由本模块**程序化合成**，并记录 effective_rule_hash 以便复现。
 */
const { sha256, stableStringify } = require('./ids');

/** 从品牌 Skill 状态推导可用性 */
function usability(skill) {
  if (!skill) {
    return { state: 'MISSING_NOT_APPROVED', formalUsable: false, testDraftUsable: false,
      note: '该品牌尚无已登记 Skill，不能生成任何输出。' };
  }
  if (skill.state === 'APPROVED') {
    return { state: 'APPROVED', formalUsable: true, testDraftUsable: true, note: '已批准 Skill 可用于正式输出。' };
  }
  if (skill.state === 'REFERENCE_ONLY') {
    return {
      state: 'REFERENCE_ONLY', formalUsable: false, testDraftUsable: true,
      note: '该 Skill 仅为**文件规范包引用**（未在资料库正式批准与版本核验）。可用于测试草稿，'
        + '不得作为正式品牌输出。'
    };
  }
  return {
    state: skill.state || 'MISSING_NOT_APPROVED', formalUsable: false, testDraftUsable: false,
    note: '该品牌 Skill 尚未批准，禁止生成输出（不得套用其他品牌的规则）。'
  };
}

function listSkills(db, brandCode) {
  return (db.skill_versions || [])
    .filter((s) => s.brandCode === brandCode)
    .map((s) => Object.assign({}, s, usability(s)));
}

function resolveSkill(db, brandCode, skillCode) {
  const list = (db.skill_versions || []).filter((s) => s.brandCode === brandCode
    && (!skillCode || s.skillCode === skillCode));
  return list.length ? usability(list[0]) : usability(null);
}

function listTemplates(db, brandCode, filter) {
  const f = filter || {};
  return (db.creative_templates || []).filter((t) => t.brandCode === brandCode
    && (!f.platform || t.platform === f.platform)
    && (!f.mode || t.mode === f.mode));
}

function resolveTemplate(db, id) {
  return (db.creative_templates || []).find((t) => t.id === id) || null;
}

/** 品牌视觉硬约束（VFIB 来自 04 §2 / 07 §2；U CARD 无已批准规则，不套用） */
function brandRules(brand) {
  if (brand && brand.code === 'VFIB') {
    return {
      palette: ['#071D49', '#0C2E69', '#C78B27', '#A9670C', '#FCFBF7', '#F4EFE5', '#E6D8BD'],
      constraints: [
        'Neutral Architectural White 基调，背景不得偏黄（No Yellow Cast）',
        '正式 Logo 不得由 AI 重绘或改写字形',
        '不得臆造真实网银界面、储备图表或精确财务数据',
        '不得出现加密货币式炫金视觉或装饰性指标堆叠'
      ],
      allowed: true
    };
  }
  return {
    palette: [],
    constraints: ['该品牌没有已批准的设计规则：不得套用其他品牌的视觉规范'],
    allowed: false
  };
}

/**
 * 输出意图归一化。
 *
 * 安全取向：**失效关闭（fail-closed）**。
 * 旧实现写成 `outputIntent === 'FORMAL' ? 'FORMAL' : 'TEST_DRAFT'`，导致任何未识别取值
 * （拼写错误、大小写差异、`FORMAL_OUTPUT` 之类的别名、甚至漏传）都静默降级为最宽松的
 * TEST_DRAFT —— 未批准 Skill 因此可能绕过正式输出门禁（BUILD-02 自检 A-11）。
 * 现在：显式别名映射；**未识别取值一律按未授权处理并阻断**。
 */
const INTENT_ALIASES = {
  FORMAL: 'FORMAL', FORMAL_OUTPUT: 'FORMAL', FORMALOUTPUT: 'FORMAL', PUBLISH: 'FORMAL',
  PRODUCTION: 'FORMAL', RELEASE: 'FORMAL',
  TEST_DRAFT: 'TEST_DRAFT', TEST: 'TEST_DRAFT', DRAFT: 'TEST_DRAFT', TESTDRAFT: 'TEST_DRAFT'
};

function normalizeIntent(raw) {
  const s = String(raw === undefined || raw === null || raw === '' ? 'TEST_DRAFT' : raw)
    .trim().toUpperCase().replace(/[\s-]+/g, '_');
  return INTENT_ALIASES[s] || null;
}

/**
 * 合成受控提示词（Brand Rule Engine）。
 * @returns {{blocked:boolean, blockReason:string, prompt:string, effectiveRuleHash:string, ruleSnapshot:object}}
 */
function buildPrompt(db, input) {
  const brand = (db.brands || []).find((b) => b.code === input.brandCode);
  const skill = resolveSkill(db, input.brandCode, input.skillCode);
  const rules = brandRules(brand);
  const intent = normalizeIntent(input.outputIntent);

  const ruleSnapshot = {
    brandCode: input.brandCode,
    skillCode: input.skillCode || '',
    skillVersion: (db.skill_versions || []).filter((s) => s.brandCode === input.brandCode)[0] || null,
    mode: input.mode || '',
    platform: input.platform || '',
    templateCode: input.templateCode || '',
    aspect: input.aspect || '',
    display: input.display || '',
    pillarCode: input.pillarCode || '',
    narrativeCode: input.narrativeCode || '',
    visualCode: input.visualCode || '',
    brandRulesAllowed: rules.allowed
  };
  // 只把**规则输入**纳入哈希：prompt 文本本身由规则确定性派生，因此可复现
  const effectiveRuleHash = sha256(stableStringify({
    brandCode: ruleSnapshot.brandCode,
    mode: ruleSnapshot.mode,
    platform: ruleSnapshot.platform,
    templateCode: ruleSnapshot.templateCode,
    aspect: ruleSnapshot.aspect,
    display: ruleSnapshot.display,
    pillarCode: ruleSnapshot.pillarCode,
    narrativeCode: ruleSnapshot.narrativeCode,
    visualCode: ruleSnapshot.visualCode
  }));

  // 未识别的输出意图：按未授权处理（fail-closed），绝不静默降级为测试草稿
  if (!intent) {
    return {
      blocked: true,
      blockReason: '未识别的输出意图 outputIntent=' + JSON.stringify(input.outputIntent)
        + '（仅支持 FORMAL 正式输出 / TEST_DRAFT 测试草稿）；按未授权处理，已阻断。',
      prompt: '', effectiveRuleHash, ruleSnapshot
    };
  }
  if (intent === 'FORMAL' && !skill.formalUsable) {
    return { blocked: true, blockReason: skill.note, prompt: '', effectiveRuleHash, ruleSnapshot };
  }
  if (!skill.testDraftUsable) {
    return { blocked: true, blockReason: skill.note, prompt: '', effectiveRuleHash, ruleSnapshot };
  }
  if (!rules.allowed) {
    return { blocked: true, blockReason: rules.constraints[0], prompt: '', effectiveRuleHash, ruleSnapshot };
  }

  const lines = [];
  lines.push('【' + (intent === 'FORMAL' ? '正式输出' : '测试草稿（非正式品牌输出）') + '】品牌：' + (brand ? brand.name : input.brandCode));
  lines.push('Skill：' + (ruleSnapshot.skillVersion ? (ruleSnapshot.skillVersion.skillCode + ' ' + ruleSnapshot.skillVersion.version + '（' + skill.state + '）') : '（未登记）'));
  lines.push('用途：平台 ' + (input.platform || '未指定') + '；模式 ' + (input.mode || '未指定')
    + '；模板 ' + (input.templateCode || '未指定') + '；画幅 ' + (input.aspect || '未指定')
    + '；显示分档 ' + (input.display || '未指定'));
  lines.push('内容参数：栏目 ' + (input.pillarCode || '—') + '；叙事 ' + (input.narrativeCode || '—')
    + '；视觉 ' + (input.visualCode || '—') + '；风险等级 ' + (input.riskGrade || '—'));
  if (rules.palette.length) lines.push('品牌色板（仅程序化排版使用精确 HEX）：' + rules.palette.join(' '));
  lines.push('硬性约束：');
  for (const c of rules.constraints) lines.push('- ' + c);
  lines.push('画面方向（Brief）：' + String(input.brief || '').slice(0, 1200));
  lines.push('输出要求：仅生成氛围/建筑/摄影/底纹类画面；精确文字、表格、Logo、字体由程序化排版引擎完成。');

  return { blocked: false, blockReason: '', prompt: lines.join('\n'), effectiveRuleHash, ruleSnapshot };
}

module.exports = { usability, listSkills, resolveSkill, listTemplates, resolveTemplate, brandRules, buildPrompt };
