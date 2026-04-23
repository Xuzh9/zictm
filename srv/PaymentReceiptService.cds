using { com.sap.zictm as db } from '../db/schema';  

service PaymentReceiptService {
    /**
     * 调拨单
     */
    entity PaymentReceipt as projection on db.PaymentReceipt;
}