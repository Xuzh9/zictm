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
     * 销售订单修改表
     */
    entity PITransfer as projection on db.PITransfer;

    /**
     * PI销售订单关系表
     * code: S-成功, E-失败
     * message: 失败时返回最小失败步骤的message
     */
    entity PISalesOrderRel as projection on db.PISalesOrderRel {
        *,
        cast(null as String(2)) as code : String(2) @title: '状态',
        cast(null as String(255)) as message : String(255) @title: '消息'
    };

    /**
     * PI交货单关系表
     */
    entity PIDeliveryRel as projection on db.PIDeliveryRel;

    action SOCreate(data: array of SalesOrderCreate) returns array of SalesOrderCreate;
    action SOChange(data: array of SalesOrderChange) returns array of SalesOrderChange;
    action Transfer(data: array of PITransfer) returns array of PITransfer;
}