using { com.sap.zictm as db } from '../db/schema';
using { Core, Common } from '@sap/cds/common';

service MultistepLogService {
    entity MultistepLog as projection on db.MultistepLog actions {
        action retryStep() returns MultistepLog;
    };
}