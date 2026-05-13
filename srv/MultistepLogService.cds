using { com.sap.zictm as db } from '../db/schema';
using { Core, Common } from '@sap/cds/common';

service MultistepLogService {
    entity MultistepLog as projection on db.MultistepLog actions {
        // ✅ 关键：必须返回当前实体，前端才能刷新
        action retryStep() returns MultistepLog;
    };
}