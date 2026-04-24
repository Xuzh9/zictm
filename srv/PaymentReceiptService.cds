using { com.sap.zictm as db } from '../db/schema';  

service PaymentReceiptService {
    /**
     * 调拨单
     */
    entity PaymentReceipt as projection on db.PaymentReceipt;

    action Create(data: array of PaymentReceipt) returns array of PaymentReceipt;
}