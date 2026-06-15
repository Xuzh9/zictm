using { com.sap.zictm as db } from '../db/schema';  

service ReportService {
    /**
     * PI销售订单关系表
     */
    @readonly
    entity PISalesOrderRel as select from db.PISalesOrderRel
        left outer join db.SalesOrderCreate
            on PISalesOrderRel.PIOrder = SalesOrderCreate.PIOrder
            and PISalesOrderRel.PIOrderItem = SalesOrderCreate.PIOrderItem
        {
            key PISalesOrderRel.PIOrder,
            key PISalesOrderRel.PIOrderItem,
            PISalesOrderRel.zrfc_logid,
            PISalesOrderRel.SalesOrder,
            PISalesOrderRel.SalesOrderItem,
            PISalesOrderRel.PurchaseOrder1,
            PISalesOrderRel.PurchaseOrderItem1,
            PISalesOrderRel.SalesOrder1,
            PISalesOrderRel.SalesOrderItem1,
            PISalesOrderRel.PurchaseOrder2,
            PISalesOrderRel.PurchaseOrderItem2,
            PISalesOrderRel.SalesOrder2,
            PISalesOrderRel.SalesOrderItem2,
            PISalesOrderRel.ProductionOrder,
            SalesOrderCreate.zrfcid,
            SalesOrderCreate.zdfjy
        };
    
    /**
     * PI交货单关系表
     */
    @readonly
    entity PIDeliveryRel as select from db.PIDeliveryRel
        left outer join db.DeliveryActualInfo
            on PIDeliveryRel.DeliveryDocument = DeliveryActualInfo.DeliveryDocument
            and PIDeliveryRel.DeliveryDocumentItem = DeliveryActualInfo.DeliveryDocumentItem
        {
            key PIDeliveryRel.PIOrder,
            key PIDeliveryRel.PIOrderItem,
            key PIDeliveryRel.DeliveryDocument,
            key PIDeliveryRel.DeliveryDocumentItem,
            PIDeliveryRel.ParentItem,
            PIDeliveryRel.zrfc_logid,
            PIDeliveryRel.SalesOrderType,
            PIDeliveryRel.DeliveryNo1,
            PIDeliveryRel.DeliveryNoItem1,
            PIDeliveryRel.InboundDeliveryNo1,
            PIDeliveryRel.InboundDeliveryNoItem1,
            DeliveryActualInfo.zrfcid
        };

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