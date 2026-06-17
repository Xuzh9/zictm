using { com.sap.zictm as db } from '../db/schema';
using { Core, Common } from '@sap/cds/common';

service ApiInputLogService {
    // 接口入参日志表
    @readonly
    entity ApiInputLog as projection on db.ApiInputLog;
}
