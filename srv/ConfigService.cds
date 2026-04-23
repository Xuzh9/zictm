using { com.sap.zictm as db } from '../db/schema';  

service ConfigService {
    /**
     * 业务流程配置表
     */
    entity ProcessConfig as projection on db.ProcessConfig;
    
    /**
     * 步骤配置表
     */
    entity StepConfig as projection on db.StepConfig;
    
    /**
     * 多方交易类型配置表
     */
    entity MPTTypeConfig as projection on db.MPTTypeConfig;
    
    /**
     * 多方交易步骤配置表
     */
    entity MPTStepConfig as projection on db.MPTStepConfig;
}

annotate ConfigService.ProcessConfig with @odata.draft.enabled; 
annotate ConfigService.MPTTypeConfig with @odata.draft.enabled; 