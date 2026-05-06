using { com.sap.zictm as db } from '../db/schema';

service MultistepLogService {
    entity MultistepLog as projection on db.MultistepLog actions {
        action retryStep @(Core.MediaType : 'application/json')(
        ) returns {
            code: String;
            message: String;
        };
    };
}