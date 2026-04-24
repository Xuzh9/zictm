using { com.sap.zictm as db } from '../db/schema';  

service DeliveryService {
    /**
     * 销售出库单
     */
    entity OutboundDelivery as projection on db.OutboundDelivery;

    action Create(data: array of OutboundDelivery) returns array of OutboundDelivery;
}