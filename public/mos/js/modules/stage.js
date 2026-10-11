/* 分阶段状态页 —— Creative Studio / Publishing / Analytics / Governance & Assets。
 * 这些中心在 BUILD-01 不交付业务功能。本页**明确**说明阶段归属与计划范围，
 * 不放置任何"看起来能点但无实际作用"的假按钮（07 §7 设计验收禁令）。
 */
import { esc, stateBlock } from '../ui.js';

let ctxRef = null; let hostEl = null;

const STAGE_INFO = {
  creative: {
    crumb: 'Creative Studio',
    title: 'Content & Visual Studio',
    stage: 'BUILD-02',
    scope: [
      '文案编辑器：Brief / 证据 / 正文三栏，自动保存与失败恢复',
      'ContentVersion 冻结（LOCKED_FOR_REVIEW）与版本不可覆盖哈希',
      'Skill Loader 与模板选择（无已批准 Skill 时阻断正式输出）',
      'Visual Studio：参数→模板→Prompt 预览→Generate；至少一个真实图片 Provider，无 Key 时明确 MOCK',
      'WorkingAsset / GenerationJob / 基础 QA 与预算（BUDGET_EXCEEDED）',
      'Video Workspace：Brief / 脚本 / 分镜 / 字幕 / 关键帧（F01–F04、M01–M05）'
    ],
    gate: 'Gate B（E2E-03、SEC-02）'
  },
  publishing: {
    crumb: 'Publishing Center',
    title: 'Publishing',
    stage: 'BUILD-02',
    scope: [
      'Editorial Calendar 月/周/列表与拖拽排期（只改计划时间）',
      'Publishing Queue：Ready / Scheduled / Blocked / Failed',
      '人工发布登记：真实 URL、时间、渠道、证据 → 生成不可覆盖 PublishedArtifact',
      'Published Archive：检索已发布快照、表现、更正历史（快照不可编辑）',
      '三条审批链中的**发布审核**（PUBLISHING_APPROVER）'
    ],
    gate: 'Gate B（E2E-04、SEC-04）'
  },
  analytics: {
    crumb: 'Analytics Center',
    title: 'Analytics',
    stage: 'BUILD-03',
    scope: [
      'Content：栏目 / Topic / 内容产出表现（真实聚合）',
      'Channels：公开渠道指标，带来源与时间标记',
      'Operations：计划执行、审核耗时、延期',
      'AI & Cost：作业、耗时、**实际可核**费用与币种'
    ],
    gate: 'Gate C',
    note: '未接入的指标一律显示为「缺失」，不用占位数字填充（08 §Gate C）。'
  },
  governance: {
    crumb: 'Governance & Assets',
    title: 'Governance & Assets',
    stage: 'BUILD-03',
    scope: [
      '三条独立审批链：专业审核 / 发布审核 / 资产入库',
      'AssetAdmission：预检 → 最终审批 → LibraryGateway 幂等同步',
      'Approved Assets：仅授权范围内检索已批准资产',
      '权限收口、审计完整性、失败恢复'
    ],
    gate: 'Gate C（E2E-05、SEC-01/03/08/09/10）',
    note: '最终入库许可 `library.asset.approve.final` 是**独立特权**，不自动赋给 P1 或技术管理员。'
  }
};

function head(info, ctx) {
  return '<div class="page-head"><div class="crumb">' + esc(info.crumb) + '</div>'
    + '<div class="ph-row"><h1>' + esc(info.title) + '</h1>'
    + '<span class="badge badge-warn">' + esc(info.stage) + ' 交付</span>'
    + '<span class="pill">当前品牌 ' + esc((ctx && ctx.brand) || '—') + '</span></div>'
    + '<div class="ph-desc">本工作中心不在 BUILD-01（Gate A）范围内，尚未实现业务功能。</div></div>';
}

async function render() {
  const ctx = ctxRef;
  const info = STAGE_INFO[ctx.module.id] || STAGE_INFO.creative;

  let html = head(info, ctx);
  html += '<div class="card"><div class="card-head"><h2>阶段与范围</h2></div><div class="card-body">'
    + '<div class="callout warn">该中心计划在 <strong>' + esc(info.stage) + '</strong> 交付，对应 <strong>' + esc(info.gate) + '</strong>。'
    + 'BUILD-01 只交付到「策划 + 情报」闭环，因此此处不提供操作入口——避免出现无实际作用的界面。</div>'
    + '<h3 style="margin:10px 0 6px">计划包含</h3>'
    + '<ul style="margin:0 0 0 18px;font-size:13px;line-height:1.8">' + info.scope.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>'
    + (info.note ? '<div class="callout info" style="margin-top:12px">' + esc(info.note) + '</div>' : '')
    + '</div></div>';

  html += '<div class="card"><div class="card-head"><h2>当前可用替代路径</h2></div><div class="card-body">'
    + '<div class="row" style="gap:8px;flex-wrap:wrap">'
    + '<button class="btn btn-sm" data-go="planning">前往 Monthly Planning</button>'
    + '<button class="btn btn-sm" data-go="topics">前往 Master Topics</button>'
    + '<button class="btn btn-sm" data-go="intelligence">前往 Intelligence</button>'
    + '<button class="btn btn-sm" data-go="tasks">前往 Content Tasks</button>'
    + '<button class="btn btn-sm" data-go="campaigns">前往 Campaigns</button>'
    + '</div>'
    + '<div class="hint">已完成的能力仍可正常使用；未完成的中心不会给出任何假成功反馈。</div>'
    + '</div></div>';

  html += '<div class="card"><div class="card-head"><h2>明确不在任何阶段的范围内</h2></div><div class="card-body">'
    + '<div class="checkline no"><span class="ck">✕</span><span>S05 客户增长体系（申请-激活-使用-留存漏斗、CAC、行为归因）— <strong>MARK-S05</strong></span></div>'
    + '<div class="checkline no"><span class="ck">✕</span><span>品牌声誉监测与风险登记专项 — <strong>MARK-BRAND-RISK</strong>（常规内容纠错仍保留）</span></div>'
    + '<div class="checkline no"><span class="ck">✕</span><span>营销线索移交与业务闭环 — <strong>MARK-LEAD-HANDOFF</strong></span></div>'
    + '<div class="checkline no"><span class="ck">✕</span><span>代理后台 / 佣金 / 代理合同 / KYC / 银行卡 / 资金交易</span></div>'
    + '<div class="checkline no"><span class="ck">✕</span><span>社交平台自动发布、客户私信机器人、云端视频全自动生成</span></div>'
    + '</div></div>';

  hostEl.innerHTML = html;
  hostEl.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.navigate(b.dataset.go)));
  void stateBlock;
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
