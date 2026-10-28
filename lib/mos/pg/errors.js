'use strict';
class PgBoundaryError extends Error {
 constructor(code,status=500,retryable=false){super(code);this.name='PgBoundaryError';this.code=code;this.status=status;this.retryable=retryable;}
}
function mapError(e){
 if(e instanceof PgBoundaryError)return e;
 const codes={'23505':['PG_UNIQUE_CONFLICT',409],'23503':['PG_REFERENCE_CONFLICT',409],'23514':['PG_INVALID_STATE',400],'23502':['PG_REQUIRED_FIELD',400],'42501':['PG_ACCESS_DENIED',403],'55000':['PG_IMMUTABLE_RECORD',409],'40P01':['PG_DEADLOCK',409,true],'40001':['PG_SERIALIZATION_CONFLICT',409,true],'57014':['PG_TIMEOUT',504],'55P03':['PG_LOCK_TIMEOUT',504],'22P02':['PG_BAD_PARAMETER',400],'22003':['PG_BAD_PARAMETER',400],'22007':['PG_BAD_PARAMETER',400]};
 const found=codes[e&&e.code];return found?new PgBoundaryError(...found):new PgBoundaryError('PG_UNAVAILABLE',503);
}
module.exports={PgBoundaryError,mapError};
