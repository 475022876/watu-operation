'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {PgBoundaryError}=require('./errors');
const active=new AsyncLocalStorage();
function assertOutsideTransaction(){if(active.getStore())throw new PgBoundaryError('EXTERNAL_IO_IN_TRANSACTION',500);}
async function outsideTransaction(operation){assertOutsideTransaction();return operation();}
module.exports={active,assertOutsideTransaction,outsideTransaction};
