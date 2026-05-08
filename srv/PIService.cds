using { com.sap.zictm as db } from '../db/schema';  

service PIService {
    /**
     * 销售订单创建表
     */
    entity SalesOrderCreate as projection on db.SalesOrderCreate;

    /**
     * 销售订单修改表
     */
    entity SalesOrderChange as projection on db.SalesOrderChange;

    /**
     * PI销售订单关系表
     */
    entity PISalesOrderRel as projection on db.PISalesOrderRel;
    
    /**
     * PI交货单关系表
     */
    entity PIDeliveryRel as projection on db.PIDeliveryRel;

    action SOCreate(data: array of SalesOrderCreate) returns array of SalesOrderCreate;
    action SOChange(data: array of SalesOrderChange) returns array of SalesOrderChange;
}