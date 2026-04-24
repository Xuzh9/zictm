using { com.sap.zictm as db } from '../db/schema';  

service StockTransferService {
    /**
     * 调拨单
     */
    entity Transfer as projection on db.Transfer;

    action Create(data: array of Transfer) returns array of Transfer;
}