'use strict';
/**
 * 路由注册入口。所有业务路由均在 /api/mos/ 前缀下，与静态资源、健康检查清晰分离。
 */
require('./auth');
require('./meta');
require('./plans');
require('./campaigns');
require('./topics');
require('./tasks');
require('./sources');
require('./admin');
