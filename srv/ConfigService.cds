using { com.sap.zictm as db } from '../db/schema';  
/**
 * 配置维护服务
 * 用于前台展示和维护配置表
 */
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