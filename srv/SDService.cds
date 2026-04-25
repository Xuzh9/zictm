using { com.sap.zictm as db } from '../db/schema';  

service SDService {
    /**
     * 调拨单
     */
    entity Transfer as projection on db.Transfer;
    /**
     * 调拨单
     */
    entity PaymentReceipt as projection on db.PaymentReceipt;
    /**
     * 销售出库单
     */
    entity OutboundDelivery as projection on db.OutboundDelivery;

    action TrCreate(data: array of Transfer) returns array of Transfer;
    action PrCreate(data: array of PaymentReceipt) returns array of PaymentReceipt;
    action OdCreate(data: array of OutboundDelivery) returns array of OutboundDelivery;
}