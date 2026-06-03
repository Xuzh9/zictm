using { com.sap.zictm as db } from '../db/schema';  

service ReportService {
    /**
     * PI销售订单关系表
     */
    entity PISalesOrderRel @readonly as projection on db.PISalesOrderRel;
    
    /**
     * PI交货单关系表
     */
    entity PIDeliveryRel @readonly as projection on db.PIDeliveryRel;
}