'use strict';
/**
 * Marketing OS —— 首次初始化种子。
 *
 * 两种数据，必须严格区分：
 *   1) **引导账号**（mosadmin）：非 DEMO；密码取 MOS_ADMIN_PASSWORD，未提供则随机生成并
 *      仅打印一次；首登强制改密。
 *   2) **DEMO 数据**（品牌/演示账号/计划/项目/选题/来源/资讯）：全部带 `demo:true`
 *      或名称含「演示」字样，UI/API 必须显著标注 DEMO（00 §5、08 §6）。
 *
 * 不做的事：不预置任何"已批准资产"、不预置任何发布记录、不预置任何真实监管结论。
 */
const { hashPassword, randomPassword } = require('../password');
const { uid } = require('./ids');
const { BRANDS, ROLES } = require('./dict');

const NOW = () => new Date().toISOString();

function roleGrant(userId, roleCode, brandScope) {
  return { id: uid('ur'), userId, roleCode, brandScope: brandScope || ['*'], grantedAt: NOW() };
}

/**
 * BUILD-02 演示数据（Skill 登记 / 创意模板 / 渠道登记）。
 *
 * 单独导出，供两处复用，保证「首次初始化」与「v1 库升级到 v2」得到完全一致的数据：
 *   1) buildSeed() —— 全新初始化；
 *   2) store.migrate() —— v1→v2 升级时补种（仅当对应集合为空）。
 * 全部带 `demo:true`，UI 必须显著标注 DEMO。
 *
 * 注意：这里**不包含**任何"已批准资产"、发布记录或真实监管结论。
 */
function buildBuild02Seed() {
  /**
   * Skill 版本登记（04 §2）：未 APPROVED 不得用于正式输出。
   *   - VFIB 仅持 REFERENCE_ONLY：可用作参考/测试草稿，**不得**作为正式输出依据；
   *   - U CARD 的独立 Skill 尚未批准 → MISSING_NOT_APPROVED：**禁止套用 VFIB 规则**。
   * 这两条不是"演示文案"，而是 skill.js 里被强制执行的门禁。
   */
  const skillVersions = [
    {
      id: 'skv_vfib_guardian_12', brandCode: 'VFIB', skillCode: 'VISUAL_BRAND_GUARDIAN', version: '1.2',
      checksum: 'UNVERIFIED_FILE_PACKAGE', approvalRef: '', state: 'REFERENCE_ONLY',
      note: 'Visual Brand Guardian V1.2 为**文件规范包引用**，非已上线资料库 Skill（00 §0.1-3）；正式启用前需最终批准与版本核验。',
      activatedAt: null, demo: true, createdAt: NOW()
    },
    {
      id: 'skv_ucard_independent', brandCode: 'UCARD', skillCode: 'UCARD_BRAND_SKILL', version: '—',
      checksum: '', approvalRef: '', state: 'MISSING_NOT_APPROVED',
      note: 'U CARD 独立 Skill 尚未批准：以占位能力存在，**不得套用** VFIB 设计规则（00 §1）。',
      activatedAt: null, demo: true, createdAt: NOW()
    }
  ];

  /** 创意模板：VFIB 有 4 个登记模板（版本锁定）；U CARD 为空 —— 不套用他牌模板 */
  const SKILL_REF = 'skv_vfib_guardian_12';
  const creativeTemplates = [
    { id: 'tpl_vfib_li_a', platform: 'LINKEDIN', mode: 'MODE-A', templateCode: 'PPT-01', display: 'D1', aspects: ['1:1', '4:5'], label: 'LinkedIn 机构观点 · 单图' },
    { id: 'tpl_vfib_li_c', platform: 'LINKEDIN', mode: 'MODE-B', templateCode: 'PPT-02', display: 'D2', aspects: ['4:5'], label: 'LinkedIn 文档轮播 · 封面' },
    { id: 'tpl_vfib_x_a', platform: 'X', mode: 'MODE-A', templateCode: 'PPT-03', display: 'D0', aspects: ['16:9'], label: 'X 专业短线程 · 配图' },
    { id: 'tpl_vfib_yt_a', platform: 'YOUTUBE', mode: 'MODE-A', templateCode: 'PPT-05', display: 'D1', aspects: ['16:9'], label: 'YouTube 知识库 · 关键帧底图' }
  ].map((t) => Object.assign({
    brandCode: 'VFIB', skillVersionId: SKILL_REF, version: 1, state: 'REFERENCE_ONLY',
    config: { neutralWhite: true, noYellowCast: true, logoRedraw: false, programmaticTypesetting: true },
    note: '模板版本已锁定；生成记录保存 template_version 与 effective_rule_hash（04 §2）。',
    demo: true, createdAt: NOW()
  }, t));

  /** 渠道登记（05 §2）：只登记官方账号标识与公开 URL，**绝不保存密码/令牌** */
  const channels = [
    {
      id: 'ch_vfib_li', brandCode: 'VFIB', platform: 'LINKEDIN', handle: '@vfib-bank',
      url: 'https://www.linkedin.com/company/vfib-bank', label: 'VFIB 机构主页（DEMO 占位）',
      state: 'ENABLED', publishMode: 'MANUAL', ownerId: 'user_demo_p3', lastVerifiedAt: NOW(),
      demo: true, createdAt: NOW(), updatedAt: NOW(), rowVersion: 1
    },
    {
      id: 'ch_vfib_x', brandCode: 'VFIB', platform: 'X', handle: '@vfbbank_demo',
      url: 'https://x.com/vfbbank_demo', label: 'VFIB 官方 X（DEMO 占位）',
      state: 'ENABLED', publishMode: 'MANUAL', ownerId: 'user_demo_p3', lastVerifiedAt: NOW(),
      demo: true, createdAt: NOW(), updatedAt: NOW(), rowVersion: 1
    },
    {
      id: 'ch_ucard_x', brandCode: 'UCARD', platform: 'X', handle: '@ucard_demo',
      url: 'https://x.com/ucard_demo', label: 'U CARD 官方 X（DEMO 占位）',
      state: 'ENABLED', publishMode: 'MANUAL', ownerId: 'user_demo_p2', lastVerifiedAt: NOW(),
      demo: true, createdAt: NOW(), updatedAt: NOW(), rowVersion: 1
    }
  ];

  return { skill_versions: skillVersions, creative_templates: creativeTemplates, channels };
}

function buildSeed() {
  const cfgAdmin = (process.env.MOS_ADMIN_PASSWORD && String(process.env.MOS_ADMIN_PASSWORD).length >= 8)
    ? String(process.env.MOS_ADMIN_PASSWORD)
    : randomPassword(14);

  const adminHash = hashPassword(cfgAdmin);
  const admin = {
    id: 'user_mosadmin',
    username: 'mosadmin',
    displayName: 'Marketing OS 管理员',
    externalIdentityId: 'local:mosadmin',
    dept: '品牌与市场部',
    title: '系统管理员',
    status: 'active',
    demo: false,
    salt: adminHash.salt,
    passwordHash: adminHash.hash,
    mustChangePassword: true,
    createdAt: NOW(),
    lastLoginAt: null
  };

  /* ---------- DEMO 演示身份（每人一个随机口令，首次初始化统一打印一次） ---------- */
  const demoPassword = randomPassword(12);
  const demoSpec = [
    { id: 'user_demo_p1', username: 'demo.p1', displayName: '演示·战略治理（P1）', roles: [['P1', ['VFIB']]] },
    { id: 'user_demo_p2', username: 'demo.p2', displayName: '演示·创作（P2）', roles: [['P2', ['VFIB', 'UCARD']]] },
    { id: 'user_demo_p3', username: 'demo.p3', displayName: '演示·发布（P3）', roles: [['P3', ['VFIB']], ['PUBLISHING_APPROVER', ['VFIB']]] },
    { id: 'user_demo_pr', username: 'demo.reviewer', displayName: '演示·专业审核员', roles: [['PROFESSIONAL_REVIEWER', ['VFIB', 'UCARD']]] },
    { id: 'user_demo_lfa', username: 'demo.lfa', displayName: '演示·入库最终审批人', roles: [['LIBRARY_FINAL_APPROVER', ['VFIB', 'UCARD']]] }
  ];

  const users = [admin];
  const userRoles = [roleGrant(admin.id, 'MOS_ADMIN', ['*'])];

  const demoDump = [{ username: admin.username, password: cfgAdmin, note: '引导管理员（首登需改密）' }];
  for (const spec of demoSpec) {
    const h = hashPassword(demoPassword);
    users.push({
      id: spec.id,
      username: spec.username,
      displayName: spec.displayName,
      externalIdentityId: 'local:' + spec.username,
      dept: '品牌与市场部',
      title: '演示账号',
      status: 'active',
      demo: true,
      salt: h.salt,
      passwordHash: h.hash,
      mustChangePassword: false,
      createdAt: NOW(),
      lastLoginAt: null
    });
    for (const [roleCode, scope] of spec.roles) userRoles.push(roleGrant(spec.id, roleCode, scope));
    demoDump.push({ username: spec.username, password: demoPassword, note: 'DEMO · ' + spec.roles.map((r) => r[0]).join('+') });
  }

  /* ---------- DEMO 业务数据 ---------- */
  const planId = 'plan_vfib_2026_10_v1';
  const plan = {
    id: planId,
    brandCode: 'VFIB',
    year: 2026,
    month: 10,
    version: 1,
    code: 'VFIB-2026-10-v1',
    title: '2026 年 10 月 VFIB 品牌传播与内容计划',
    objectives: [
      '围绕机构可信度输出 3 篇深度内容（DEMO）',
      '建立储备透明化叙事框架的选题池（DEMO）',
      '完成 1 次跨渠道内容适配复盘（DEMO）'
    ],
    status: 'ACTIVE',
    budgetPolicyId: null,
    ownerId: 'user_demo_p1',
    supersedesId: null,
    reviewNote: '',
    demo: true,
    createdAt: NOW(),
    updatedAt: NOW(),
    createdBy: 'user_demo_p1',
    rowVersion: 1
  };

  const planItems = [
    { id: 'pi_demo_01', planId, title: '储备透明化 · 选题论证', priority: 'P0', workDate: '2026-10-08', contentTaskId: 'task_demo_01', adHoc: false },
    { id: 'pi_demo_02', planId, title: 'X 专业短线程 · 机构稳健性', priority: 'P1', workDate: '2026-10-15', contentTaskId: 'task_demo_02', adHoc: false },
    { id: 'pi_demo_03', planId, title: 'LinkedIn 观点长文 · 跨境支付标准', priority: 'P1', workDate: '2026-10-22', contentTaskId: null, adHoc: false },
    { id: 'pi_demo_04', planId, title: '临时内容：行业会议要点摘要', priority: 'P2', workDate: '2026-10-27', contentTaskId: null, adHoc: true }
  ].map((x) => Object.assign({ demo: true, createdAt: NOW(), updatedAt: NOW() }, x));

  const campaign = {
    id: 'camp_demo_01',
    brandCode: 'VFIB',
    code: 'CMP-VFIB-0001',
    title: '机构储备透明化沟通（DEMO）',
    brief: '以公开可核验信息为基础，说明机构储备的披露原则与常见误区。禁止引用未经核准的实时市场数据。（DEMO 文案）',
    ownerId: 'user_demo_p1',
    startAt: '2026-10-05T00:00:00.000Z',
    endAt: '2026-11-15T00:00:00.000Z',
    state: 'ACTIVE',
    demo: true,
    createdAt: NOW(),
    updatedAt: NOW(),
    createdBy: 'user_demo_p1',
    rowVersion: 1
  };

  const topics = [
    {
      id: 'topic_demo_01',
      brandCode: 'VFIB',
      title: '储备披露的常见误区与事实边界（DEMO）',
      pillarCode: 'C01',
      narrativeCode: 'N01',
      riskGrade: 'G2',
      evidenceStatus: 'PARTIAL',
      summary: '汇总监管机构与行业组织关于储备披露的公开表述，明确"可宣称"与"不可宣称"的边界。（DEMO）',
      ownerId: 'user_demo_p1',
      state: 'ACTIVE',
      demo: true,
      createdAt: NOW(),
      updatedAt: NOW(),
      rowVersion: 1
    },
    {
      id: 'topic_demo_02',
      brandCode: 'UCARD',
      title: 'U CARD 消费场景教育（DEMO）',
      pillarCode: 'C01',
      narrativeCode: 'N01',
      riskGrade: 'G2',
      evidenceStatus: 'MISSING',
      summary: 'U CARD 独立 Skill 尚未批准，本条仅作占位，不得套用 VFIB 设计规则。（DEMO）',
      ownerId: 'user_demo_p2',
      state: 'DRAFT',
      demo: true,
      createdAt: NOW(),
      updatedAt: NOW(),
      rowVersion: 1
    }
  ];

  const tasks = [
    {
      id: 'task_demo_01', brandCode: 'VFIB', code: 'MOS-TASK-0001',
      title: '储备透明化 · LinkedIn 长文初稿（DEMO）', type: 'ARTICLE', platform: 'LINKEDIN',
      pillarCode: 'C01', narrativeCode: 'N01', riskGrade: 'G2',
      ownerId: 'user_demo_p2', campaignId: campaign.id, topicId: 'topic_demo_01',
      status: 'IN_PRODUCTION', productionDue: '2026-10-12', reviewDue: '2026-10-14', plannedPublishAt: '2026-10-15',
      demo: true, createdAt: NOW(), updatedAt: NOW(), rowVersion: 1
    },
    {
      id: 'task_demo_02', brandCode: 'VFIB', code: 'MOS-TASK-0002',
      title: 'X 专业短线程 · 机构稳健性（DEMO）', type: 'THREAD', platform: 'X',
      pillarCode: 'C01', narrativeCode: 'N02', riskGrade: 'G1',
      ownerId: 'user_demo_p2', campaignId: null, topicId: 'topic_demo_01',
      status: 'PLANNED', productionDue: '2026-10-18', reviewDue: null, plannedPublishAt: '2026-10-20',
      demo: true, createdAt: NOW(), updatedAt: NOW(), rowVersion: 1
    }
  ];

  const sourceRegistry = [
    {
      id: 'src_bis', brandCode: 'VFIB', domain: 'bis.org', name: 'BIS 国际清算银行（候选来源·未核验）',
      tier: 'S1', method: 'RSS', endpoint: 'https://www.bis.org/doclist/all_pressrels.rss',
      licensePolicy: 'UNVERIFIED', licenseNote: '候选来源，许可/转载权**尚未核验**，当前仅允许保存元数据与链接。',
      country: 'CH', frequency: 'DAILY', retryPolicy: 'EXP_BACKOFF_3', retentionDays: 180,
      ownerId: 'user_demo_p1',
      status: 'PENDING_VERIFICATION', allowFullText: false,
      lastOkAt: null, lastErrorAt: null, lastError: '', demo: true, createdAt: NOW(), updatedAt: NOW()
    },
    {
      id: 'src_manual', brandCode: 'VFIB', domain: 'internal.example', name: '人工登记来源（演示用）',
      tier: 'S4', method: 'MANUAL', endpoint: '',
      licensePolicy: 'METADATA_ONLY', licenseNote: '仅人工登记，不自动抓取。',
      country: '', frequency: 'MANUAL', retryPolicy: 'NONE', retentionDays: 365,
      ownerId: 'user_demo_p1', status: 'ACTIVE', allowFullText: false,
      lastOkAt: null, lastErrorAt: null, lastError: '', demo: true, createdAt: NOW(), updatedAt: NOW()
    }
  ];

  const sourceItems = [
    {
      id: 'sitem_demo_01', sourceId: 'src_manual', brandCode: 'VFIB',
      canonicalUrl: 'https://example.org/placeholder-not-a-real-source',
      title: '（DEMO）示例资讯条目：仅用于演示情报流界面', publishedAt: '2026-10-06T08:00:00.000Z',
      fetchedAt: '2026-10-06T09:00:00.000Z', language: 'zh', tier: 'S4',
      summary: '这是一条明确标注 DEMO 的示例条目，不代表任何真实监管事实。',
      licenseState: 'METADATA_ONLY', contentDigest: 'demo-digest-0001', rawStored: false,
      relevance: 'MEDIUM', aiSummaryState: 'NONE', demo: true, createdAt: NOW()
    }
  ];

  /* ---------- BUILD-02 DEMO：Skill 版本 / 创意模板 / 渠道登记 ---------- */
  /**
   * ⚠ Skill 状态是 BUILD-02 最重要的诚实性边界之一：
   *   - VFIB 的 Visual Brand Guardian V1.2 是**文件规范包引用**，不是已上线的资料库
   *     Skill → 状态 REFERENCE_ONLY：可做**测试草稿**，不得作为正式品牌输出。
   *   - U CARD 的独立 Skill 尚未批准 → MISSING_NOT_APPROVED：**禁止套用 VFIB 规则**。
   * 这两条不是"演示文案"，而是 skill.js 里被强制执行的门禁。
   */
  // BUILD-02 演示集合（Skill 登记 / 创意模板 / 渠道）—— 与 v1→v2 升级补种共用同一实现
  const build02 = buildBuild02Seed();
  const skillVersions = build02.skill_versions;
  const creativeTemplates = build02.creative_templates;
  const channels = build02.channels;

  return {
    mosSchemaVersion: 2,
    createdAt: NOW(),
    brands: BRANDS.map((b) => Object.assign({}, b)),
    users,
    user_roles: userRoles,
    sessions: [],
    monthly_plans: [plan],
    plan_items: planItems,
    campaigns: [campaign],
    monthly_campaign_links: [{ id: uid('mcl'), planId, campaignId: campaign.id, demo: true, createdAt: NOW() }],
    master_topics: topics,
    campaign_topic_links: [{ id: uid('ctl'), campaignId: campaign.id, topicId: 'topic_demo_01', demo: true, createdAt: NOW() }],
    content_tasks: tasks,
    source_registry: sourceRegistry,
    source_items: sourceItems,
    evidence_references: [
      { id: 'ev_demo_01', sourceItemId: 'sitem_demo_01', topicId: 'topic_demo_01', contentVersionId: null, claimLocator: '示例：仅演示证据引用结构', verificationState: 'UNVERIFIED', demo: true, createdAt: NOW() }
    ],
    skill_versions: skillVersions,
    creative_templates: creativeTemplates,
    content_versions: [],
    review_cases: [],
    review_decisions: [],
    working_assets: [],
    generation_jobs: [],
    video_artifacts: [],
    channels,
    publishing_schedules: [],
    publication_records: [],
    published_artifacts: [],
    publication_corrections: [],
    publication_metrics: [],
    audit_events: [],
    seq: { contentTask: 2 },
    settings: { dictionariesOverridden: false },
    _initialPasswordOnce: null,
    _demoCredentialsOnce: demoDump
  };
}

module.exports = { buildSeed, buildBuild02Seed };
