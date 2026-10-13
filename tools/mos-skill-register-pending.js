#!/usr/bin/env node
'use strict';
/**
 * Skill 待审批登记工具 —— 将品牌规范类 Skill 源文件登记为 PENDING_APPROVAL 记录。
 *
 * 用途（2026-10-14）：
 *   把《VFIB 全球社交媒体运营与内容生产指导手册》（V1.1，VFIB-BCG-S01-HANDBOOK-V1.1）
 *   作为 VISUAL_BRAND_GUARDIAN V1.2 的源文件关联，按现有 skill_versions 机制建立
 *   **待审批记录**（state = PENDING_APPROVAL）。
 *
 * 安全约束（不可削弱）：
 *   - 只**新增**记录，不修改任何既有记录（skv_vfib_guardian_12 等）；
 *   - 绝不写 APPROVED / EFFECTIVE —— PENDING_APPROVAL 在 skill.usability() 中
 *     fail-closed（formalUsable=false 且 testDraftUsable=false）；
 *   - 幂等：同 id 已存在则跳过；同 brand+skillCode 已有 PENDING_APPROVAL 时拒绝重复登记；
 *   - 必须**先停服**再运行（运行中的进程会在下次落盘时覆盖本工具的修改）；
 *   - 写盘采用唯一临时名 + rename 原子替换，覆盖前生成 `.bak-<时间戳>` 备份；
 *   - 源文件完整性校验：ZIP magic（docx）+ SHA256，哈希写入记录与审计。
 *
 * 用法：
 *   node tools/mos-skill-register-pending.js [--source <docx路径>] [--data-dir <目录>] [--dry-run]
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BRAND = 'VFIB';
const SKILL_CODE = 'VISUAL_BRAND_GUARDIAN';
const SKILL_VERSION = '1.2';
const RECORD_ID = 'skv_vfib_guardian_12_pa1';
const DEFAULT_SOURCE = 'C:\\Users\\three\\Documents\\xwechat_files\\wxid_1u34jpjbckzm22_8536\\msg\\file\\2026-10\\VFIB_全球社交媒体运营与内容生产指导手册_V1.1.docx';

function parseArgs(argv) {
  let source = DEFAULT_SOURCE;
  let dataDir = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') { source = argv[++i]; }
    else if (a === '--data-dir') { dataDir = argv[++i]; }
    else if (a === '--dry-run') { dryRun = true; }
    else if (a === '--help' || a === '-h') {
      console.log('用法: node tools/mos-skill-register-pending.js [--source <docx路径>] [--data-dir <目录>] [--dry-run]');
      process.exit(0);
    } else { console.error('未知参数：' + a); process.exit(2); }
  }
  return { source, dataDir, dryRun };
}

function main() {
  const { source, dataDir, dryRun } = parseArgs(process.argv.slice(2));
  const dir = path.resolve(dataDir || process.env.MOS_DATA_DIR || path.join(__dirname, '..', 'data'));
  const file = path.join(dir, 'mos.json');
  const src = path.resolve(source);

  /* ---- 1. 源文件完整性 ---- */
  if (!fs.existsSync(src)) { console.error('[register] 源文件不存在：' + src); process.exit(1); }
  const buf = fs.readFileSync(src);
  if (buf.length < 8 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    console.error('[register] 完整性校验失败：不是有效的 DOCX（ZIP）文件'); process.exit(1);
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const st = fs.statSync(src);
  console.log('[register] 源文件: ' + src);
  console.log('[register] 大小: ' + st.size + ' bytes | SHA256: ' + sha256);

  /* ---- 2. 读库与校验 ---- */
  if (!fs.existsSync(file)) { console.error('[register] 找不到数据文件：' + file); process.exit(1); }
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(db.skill_versions)) { console.error('[register] db.skill_versions 缺失'); process.exit(1); }
  if (!Array.isArray(db.audit_events)) { console.error('[register] db.audit_events 缺失'); process.exit(1); }

  if (!(db.brands || []).some((b) => b.code === BRAND)) {
    console.error('[register] 品牌不存在：' + BRAND); process.exit(1);
  }
  if (db.skill_versions.some((s) => s.id === RECORD_ID)) {
    const cur = db.skill_versions.find((s) => s.id === RECORD_ID);
    console.log('[register] 已登记（幂等跳过）：' + RECORD_ID + ' state=' + cur.state);
    console.log('[register] 待审批记录编号: ' + RECORD_ID);
    return;
  }
  const dupPending = db.skill_versions.find((s) => s.brandCode === BRAND
    && s.skillCode === SKILL_CODE && s.state === 'PENDING_APPROVAL' && s.id !== RECORD_ID);
  if (dupPending) {
    console.error('[register] 拒绝：已有同品牌同 SkillCode 的待审批记录 ' + dupPending.id
      + '，请先由最终审批人处置该记录'); process.exit(1);
  }

  /* ---- 3. 构造记录（只增不改；绝无 APPROVED/EFFECTIVE） ---- */
  const now = new Date().toISOString();
  const record = {
    id: RECORD_ID,
    brandCode: BRAND,
    skillCode: SKILL_CODE,
    version: SKILL_VERSION,
    state: 'PENDING_APPROVAL',
    checksum: sha256,
    approvalRef: '',
    displayName: 'VFIB Visual Brand Guardian（品牌视觉守护）V1.2 —— 待审批',
    sourceDocument: {
      fileName: path.basename(src),
      docNumber: 'VFIB-BCG-S01-HANDBOOK-V1.1',
      docVersion: '1.1',
      docDate: '2026-10-10',
      sizeBytes: st.size,
      sha256: sha256,
      receivedAt: '2026-10-14T01:16:05+08:00',
      localPath: src,
      integrity: 'ZIP magic 校验通过；editor_sdk 结构解析通过（417 节点，14 章 + 附录 A—G）'
    },
    applicability: {
      brands: [BRAND],
      excludes: ['UCARD（独立营销增长体系，单独管理，不得套用 VFIB 规则）'],
      scope: 'VFIB 银行主品牌及其官方数字传播渠道'
    },
    visualSpecStructure: {
      brandPositioning: '§2.1 品牌定位与传播原则（Human/…核心创意价值）',
      columns: 'C01—C06（§2.3 栏目规范）',
      narrative: 'N01—N05（§3.1 五种叙事结构）',
      visualLanguages: 'V01—V05（§3.2 五种视觉语言；§3.3 视觉一致性和真实性）',
      motion: 'M01—M05（§6.3 Motion Identity）',
      videoFormats: 'F01—F04（§6.2）',
      assetAndReview: 'A01—A08（§10）/ G0—G3 风险等级（§12.2）/ 十项发布前检查（§12.4）',
      appendixG: '本版实施状态与待核验（附录 G）'
    },
    validity: { effectiveFrom: null, effectiveUntil: null, activatedAt: null },
    authorization: {
      formalOutputAllowed: false,
      testDraftAllowed: false,
      finalApproverRole: 'LIBRARY_FINAL_APPROVER',
      finalApproverPermission: 'library.asset.approve.final',
      approvalRule: '最终审批只能由持有 library.asset.approve.final 特殊权限的正式身份完成；'
        + '本记录当前状态 PENDING_APPROVAL，在 skill.usability() 中 fail-closed（不得用于正式或测试输出）'
    },
    pendingChecks: [
      'C-1 身份核验：源文件标题为《VFIB 全球社交媒体运营与内容生产指导手册》V1.1'
        + '（编号 VFIB-BCG-S01-HANDBOOK-V1.1，日期 2026-10-10），全文未出现'
        + '「Visual Brand Guardian」或「V1.2」字样；须确认其与《VFIB Visual Brand Guardian Skill V1.2》'
        + '的对应关系（或补交正式 Skill 文件）',
      'C-2 版本链核验：Skill 版本 1.2 与源文件版本 1.1 的差异说明须由提交方书面确认',
      'C-3 视觉规范结构完整性：V01—V05 / N01—N05 / M01—M05 / C01—C06 均已在源文件中定位（结构核验通过，内容符合性待审）',
      'C-4 品牌范围核验：适用范围限定 VFIB；U CARD 另行管理（源文件 §适用范围 与本记录一致）',
      'C-5 附录 G 待核验项处置：源文件自带「本版实施状态与待核验」表，审批前须逐项确认状态',
      'C-6 SPECIAL-01 字典关联：如该 Skill 涉及品牌术语字典，须确认与字典核验记录的关系（当前 41 项 provisional）'
    ],
    note: 'PENDING_APPROVAL —— 待审批记录（2026-10-14 登记）。仅表示源文件已接收并建立版本登记，'
      + '不代表任何批准。批准前不得用于正式输出，也不得用于测试草稿（fail-closed）。'
      + '既有 REFERENCE_ONLY 记录（skv_vfib_guardian_12）保持不变，作为文件规范包引用历史。',
    demo: false,
    createdAt: now,
    rowVersion: 1
  };

  const audit = {
    id: 'aud_' + crypto.randomBytes(8).toString('hex'),
    actorId: 'tool:mos-skill-register-pending',
    brandCode: BRAND,
    eventType: 'skill.pending_registered',
    objectType: 'skill_version',
    objectId: RECORD_ID,
    oldState: null,
    newState: 'PENDING_APPROVAL',
    correlationId: '',
    outcome: 'ok',
    ip: '',
    metadata: {
      skillCode: SKILL_CODE,
      version: SKILL_VERSION,
      sourceDocNumber: record.sourceDocument.docNumber,
      sourceDocVersion: record.sourceDocument.docVersion,
      sourceSha256: sha256,
      sourceSizeBytes: st.size,
      pendingChecksCount: record.pendingChecks.length,
      registeredBy: '用户提交源文件（Marketing OS 会话内登记）'
    },
    timestamp: now
  };

  /* ---- 4. 原子写入 ---- */
  if (dryRun) {
    console.log('[register] DRY-RUN：不写盘。记录预览：');
    console.log(JSON.stringify(record, null, 2).slice(0, 2400));
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  const bak = file + '.bak-' + Date.now();
  fs.copyFileSync(file, bak);
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  db.skill_versions.push(record);
  db.audit_events.push(audit);
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1), 'utf8');
  fs.renameSync(tmp, file);
  console.log('[register] 已备份: ' + bak);
  console.log('[register] 已写入: ' + file);
  console.log('[register] 待审批记录编号: ' + RECORD_ID + ' | state=PENDING_APPROVAL');
}

main();
