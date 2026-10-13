'use strict';
/**
 * 路由注册入口。所有业务路由均在 /api/mos/ 前缀下，与静态资源、健康检查清晰分离。
 *
 * BUILD-01：auth / meta / plans / campaigns / topics / tasks / sources / admin
 * BUILD-02：content / reviews / creative / video / channels / publishing
 * BUILD-03：admissions（入库网关）/ analytics（真实聚合）
 */
require('./auth');
require('./meta');
require('./plans');
require('./campaigns');
require('./topics');
require('./tasks');
require('./sources');
require('./admin');
require('./content');
require('./reviews');
require('./creative');
require('./video');
require('./channels');
require('./publishing');
require('./admissions');
require('./analytics');
// V0.1.2 Phase B：AI 情报研究与候选选题
require('./research');
