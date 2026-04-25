using { com.sap.zictm as db } from '../db/schema';  

service ESService {
    /**
     * 交货单表
     */
    entity DeliveryActualInfo as projection on db.DeliveryActualInfo;

    action DN(data: array of DeliveryActualInfo) returns array of DeliveryActualInfo;
}