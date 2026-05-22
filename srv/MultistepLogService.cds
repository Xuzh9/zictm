using { com.sap.zictm as db } from '../db/schema';
using { Core, Common } from '@sap/cds/common';

service MultistepLogService {
    // 头表（带重推动作）
    entity MultistepHeadLog as projection on db.MultistepHeadLog actions {
        action retryStep() returns MultistepHeadLog;
    };
    
    // 明细表
    entity MultistepLog as projection on db.MultistepLog;
}
