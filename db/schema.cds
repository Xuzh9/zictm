namespace com.sap.zictm;

// 业务流程配置表
entity ProcessConfig {
    key zrfcid     : String(10);      // 业务流程ID
    description    : String(50);      // 业务流程描述
    isAsync        : Boolean;         // 是否异步
    
    // 与 StepConfig 的组合关系（一对多，行表）
    steps : Composition of many StepConfig 
        on steps.process.zrfcid = $self.zrfcid;
}

// 步骤配置表（ProcessConfig的行表）
entity StepConfig {
    // 关联到父实体
    process        : Association to ProcessConfig;
    
    // 组合主键
    key zrfcid     : String(10);      // 业务流程ID（外键引用）
    key canum      : Integer;         // 步骤编号（如10、20、30）
    
    // 业务字段
    description    : String(50);      // 步骤描述
    method         : String(100);     // 方法配置
    readsteps      : String(10);      // 读取步骤编号（如10、20、30）
}

// 接口入参日志表
entity ApiInputLog {
    key zrfc_logid : UUID;           // 多步ID
    inputData      : LargeString;    // 入参数据，JSON格式
    code           : String(2);      // 消息状态(S成功/E失败)
    message        : String(255);    // 消息文本
    // createdAt 和 createdBy 已从 managed 注解继承
}

// 多步执行日志表
entity MultistepLog {
    key zrfc_logid : UUID;           // 多步ID
    key zrfcid     : String(10);     // 业务流程ID
    key canum      : String(10);     // 步骤编号（如10、20、30）
    inputData      : LargeString;    // 入参数据，JSON格式
    code           : String(2);      // 消息状态(S成功/E失败)
    message        : String(255);    // 消息文本
    objkey         : String(20);     //对象号
    executionTime  : Decimal(10,2);  // 执行时间（秒）
    // createdAt, createdBy, modifiedAt, modifiedBy 已从 managed 注解继承
}

// 多方交易类型配置表
entity MPTTypeConfig {
    key zdfjy      : String(10);     // 多方交易类型ID
    description    : String(50);     // 多方交易类型描述
    zrfcid         : String(10);     // 业务流程ID
    zxsf           : String(4);      // 销售方(公司代码)
    zfcf           : String(4);      // 发出方(公司代码)
    
    // 关联到 ProcessConfig
    process        : Association to ProcessConfig;
    
    // 与 MPTStepConfig 的组合关系（一对多，行表）
    steps : Composition of many MPTStepConfig
        on steps.mptType.zdfjy = $self.zdfjy;
}

// 多方交易步骤配置表（MPTTypeConfig的行表）
entity MPTStepConfig {
    // 主键继承自父实体
    mptType        : Association to MPTTypeConfig;  // 父实体关联
    key zdfjy      : String(10);     // 多方交易类型ID
    key canum      : Integer;        // 步骤编号（如10、20、30）
    
    // 配置参数
    vkorg          : String(4);      // 销售组织
    vtweg          : String(2);      // 分销渠道
    kunnr          : String(10);     // 客户
    werks          : String(4);      // 发货工厂
    lgort          : String(4);      // 发货库存地点
    lifnr          : String(10);     // 供应商
    ekorg          : String(4);      // 采购组织
    ekgrp          : String(4);      // 采购组
    umwrk          : String(4);      // 收货工厂
    umlgo          : String(4);      // 收货库存地点
    
    // 价格和税务信息
    zjgbl          : Decimal(10,2);  // 价格比例
    mwskz          : String(3);      // 税码
    zsl            : Decimal(10,2);  // 税率
    
    // 枚举类型：价格方向
    zjgfx          : String(1) enum {      // 价格方向：成本正向/销售价格逆向
        COST_FORWARD @title: '成本正向' = 'A';
        PRICE_REVERSE @title: '销售价格逆向' = 'B';
    };     
}