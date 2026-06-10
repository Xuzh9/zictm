using { com.sap.zictm as db } from '../db/schema';  

service ReportService {
    /**
     * PI销售订单关系表
     */
    @readonly
    entity PISalesOrderRel as projection on db.PISalesOrderRel;
    
    /**
     * PI交货单关系表
     */
    @readonly
    entity PIDeliveryRel as projection on db.PIDeliveryRel;

    /**
     * 调拨单
     */
    @readonly
    entity Transfer as projection on db.Transfer;

    /**
     * 销售出库单
     */
    @readonly
    entity OutboundDelivery as projection on db.OutboundDelivery;

    /**
     * 收付款单
     */
    @readonly
    entity PaymentReceipt as projection on db.PaymentReceipt;
}