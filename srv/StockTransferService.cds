using { com.sap.zictm as db } from '../db/schema';  

service StockTransferService {
    /**
     * 调拨单
     */
    entity TransferOrder as projection on db.TransferOrder;
}