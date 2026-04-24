using { com.sap.zictm as db } from '../db/schema';  

service PISalesService {
    /**
     * 销售订单创建表
     */
    entity SalesOrderCreate as projection on db.SalesOrderCreate;

    /**
     * 销售订单修改表
     */
    entity SalesOrderChange as projection on db.SalesOrderChange;

    action Create(data: array of SalesOrderCreate) returns array of SalesOrderCreate;
    action Change(data: array of SalesOrderChange) returns array of SalesOrderChange;
}