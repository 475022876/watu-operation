'use strict';
/**
 * 系统接入（Provider 配置中心）—— V0.1.4。
 *
 * 这是**唯一的人工接入入口**：所有密钥、端点、模型、限额、外发策略都从这里写入，
 * 前端永远拿不到明文密钥（只给掩码 + 指纹）。
 *
 * 权限：`settings.manage`（仅 MOS_ADMIN；P1 等业务角色**不得**改供应商配置）。
 * 越权一律 403 + `permission.denied` 审计（与全局 RBAC 口径一致）。
 *
 * 端点：
 *   GET    /api/mos/settings/providers                 读取四类接入状态（无密钥）
 *   PUT    /api/mos/settings/providers/:kind           保存配置（密钥加密落库）
 *   DELETE /api/mos/settings/providers/:kind/key       清除密钥
 *   POST   /api/mos/settings/providers/:kind/test      真实连通性测试（可能计费）
 *   PUT    /api/mos/settings/budget                    预算上限
 *   PUT    /api/mos/settings/data-policy               数据外发分级策略
 *   GET    /api/mos/settings/usage                     调用账本与费用汇总
 */
const { get, post, put, del } = require('../router');
const { httpError } = require('../../util');
const rbac = require('../rbac');
const provideradmin = require('../provideradmin');

function requireSettings(ctx) {
  rbac.assertCan(ctx.principal, 'settings.manage', null, {
    objectType: 'provider', scene: 'provider.settings', ip: ctx.ip
  });
}

function wrap(fn) {
  return async (ctx) => fn(ctx);
}

get('/api/mos/settings/providers', wrap(async (ctx) => {
  requireSettings(ctx);
  return { ok: true, settings: provideradmin.publicViewAll() };
}));

put('/api/mos/settings/providers/:kind', wrap(async (ctx) => {
  requireSettings(ctx);
  const kind = String(ctx.params.kind || '').toLowerCase();
  let view;
  try {
    view = provideradmin.update(kind, ctx.body || {}, ctx.user || ctx.principal);
  } catch (err) {
    throw httpError(err.status || 400, String(err.message || err), err.code || 'BAD_PROVIDER_CONFIG');
  }
  return { ok: true, provider: view };
}));

del('/api/mos/settings/providers/:kind/key', wrap(async (ctx) => {
  requireSettings(ctx);
  const kind = String(ctx.params.kind || '').toLowerCase();
  let view;
  try {
    view = provideradmin.update(kind, { clearKey: true }, ctx.user || ctx.principal);
  } catch (err) {
    throw httpError(err.status || 400, String(err.message || err), err.code || 'BAD_PROVIDER_CONFIG');
  }
  return { ok: true, provider: view, note: '密钥已清除；该供应商回到 NOT_CONFIGURED，不会伪造可用。' };
}));

post('/api/mos/settings/providers/:kind/test', wrap(async (ctx) => {
  requireSettings(ctx);
  const kind = String(ctx.params.kind || '').toLowerCase();
  try {
    const result = await provideradmin.test(kind, ctx.user || ctx.principal);
    return result;
  } catch (err) {
    throw httpError(err.status || 400, String(err.message || err), err.code || 'PROVIDER_TEST_FAILED');
  }
}));

put('/api/mos/settings/budget', wrap(async (ctx) => {
  requireSettings(ctx);
  try {
    return { ok: true, budget: provideradmin.updateBudget(ctx.body || {}, ctx.user || ctx.principal) };
  } catch (err) {
    throw httpError(err.status || 400, String(err.message || err), err.code || 'BAD_BUDGET');
  }
}));

put('/api/mos/settings/data-policy', wrap(async (ctx) => {
  requireSettings(ctx);
  try {
    return { ok: true, dataPolicy: provideradmin.updatePolicy(ctx.body || {}, ctx.user || ctx.principal) };
  } catch (err) {
    throw httpError(err.status || 400, String(err.message || err), err.code || 'BAD_POLICY');
  }
}));

get('/api/mos/settings/usage', wrap(async (ctx) => {
  requireSettings(ctx);
  const q = ctx.query || {};
  const days = Number(q.days) || 30;
  return {
    ok: true,
    usage: provideradmin.usage({
      days,
      kind: q.kind ? String(q.kind) : undefined,
      limit: Number(q.limit) || 30
    })
  };
}));

/** 供员工界面读取的**只读**就绪度（不含任何配置细节与密钥） */
get('/api/mos/settings/readiness', wrap(async (ctx) => {
  if (!ctx.principal) throw httpError(401, '请先登录', 'UNAUTHORIZED');
  const out = {};
  for (const kind of provideradmin.KIND_IDS) {
    const v = provideradmin.publicView(kind);
    out[kind] = {
      kind, label: v.label, mode: v.mode, readiness: v.readiness,
      readinessReason: v.readinessReason, hasKey: v.hasKey, simulated: v.simulated
    };
  }
  out.budget = provideradmin.budget();
  out.dataPolicy = provideradmin.policy();
  return { ok: true, readiness: out };
}));
