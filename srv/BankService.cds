using { com.sap.zictm as db } from '../db/schema';  

service BankService {
    /**
     * 银行信息
     */
    @readonly
    entity BankInfo as projection on db.BankInfo ;

    action update(data: array of BankInfo) returns array of BankInfo;
}