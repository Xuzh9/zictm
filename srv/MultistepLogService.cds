using { com.sap.zictm as db } from '../db/schema';
using { Core, Common } from '@sap/cds/common';

service MultistepLogService {
    entity MultistepLog as projection on db.MultistepLog actions {
        action retryStep() returns MultistepLog;
    };
}

// 标准的 SideEffects 配置
annotate service.MultistepLog with @Core.SideEffects : {
    SourceEntities : [
        {
            Type : Core.SourceEntityType.Action,
            Action : 'MultistepLogService.MultistepLog.retryStep',
            EntitySet : 'MultistepLog'
        }
    ],
    TargetEntities : [
        {
            EntitySet : 'MultistepLog',
            Type : Core.TargetEntityType.EntitySet
        }
    ]
};