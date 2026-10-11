'use strict';
/**
 * MockKnowledgeGateway —— 企业品牌知识检索占位（06 §1/§2）。
 *
 * ⚠ MOCK 声明：企业资料库/知识库**真实 API 尚未审计**（06 §1），本适配器返回
 *   sandbox 标记的模拟结果，**不得**被当作"企业正式批准知识"。
 *   真实接通前，任何界面都必须显示 MOCK/INTEGRATION_PENDING。
 *
 * 契约（06 §2）：searchApproved(query, scope) / resolveDocument(id, version)
 */

const KNOWLEDGE_SANDBOX = [
  {
    id: 'kb-sandbox-001',
    title: '（MOCK）品牌术语与对外表述基线',
    version: 'v0.0-sandbox',
    source: 'sandbox',
    excerpt: '本条目为沙盒占位：用于演示"正式术语可检索"的交互，不代表任何已批准文本。'
  },
  {
    id: 'kb-sandbox-002',
    title: '（MOCK）机构稳健性沟通要点',
    version: 'v0.0-sandbox',
    source: 'sandbox',
    excerpt: '沙盒占位条目，禁止用于对外发布。'
  }
];

function status() {
  return {
    gateway: 'knowledge',
    mode: 'mock',
    sandbox: true,
    message: '企业资料库/知识库真实接口尚未审计接通（06 §1），当前为 MOCK。'
  };
}

async function searchApproved(query, scope) {
  const q = String(query || '').trim().toLowerCase();
  const hits = KNOWLEDGE_SANDBOX
    .filter((h) => !q || h.title.toLowerCase().indexOf(q) !== -1 || h.excerpt.toLowerCase().indexOf(q) !== -1)
    .map((h) => Object.assign({}, h, { mock: true, brandScope: scope && scope.brandCode ? scope.brandCode : '' }));
  return { mode: 'mock', sandbox: true, query: query || '', items: hits };
}

async function resolveDocument(id) {
  const hit = KNOWLEDGE_SANDBOX.find((h) => h.id === id);
  if (!hit) return { mode: 'mock', sandbox: true, error: 'MOCK 知识条目不存在', id };
  return { mode: 'mock', sandbox: true, id, title: hit.title, version: hit.version, body: hit.excerpt };
}

module.exports = { status, searchApproved, resolveDocument };
