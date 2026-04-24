namespace com.sap.zictm;

type PriceDirection : String(1) enum {
    COST_FORWARD  @title: '成本正向' = 'A';
    PRICE_REVERSE @title: '销售价格逆向' = 'B';
};

// 业务流程配置表
entity ProcessConfig {
    key zrfcid     : String(10);      // 业务流程ID
    description    : String(50);      // 业务流程描述
    businessTable1 : String(50);      // 业务表名1
    businessTable2 : String(50);      // 业务表名2
    businessTable3 : String(50);      // 业务表名3
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
    serviceName    : String(100);     // 服务文件名
    readsteps      : String(10);      // 读取步骤编号（如10、20、30）
}

// 接口入参日志表
entity ApiInputLog {
    key id         : UUID;           // ID
    inputData      : LargeString;    // 入参数据，JSON格式
    code           : String(2);      // 消息状态(S成功/E失败)
    message        : String(255);    // 消息文本
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
    zjgfx          : PriceDirection;
}

//调拨单
entity Transfer {
    key TransferOrder            : String(10);         // 调拨单
    key TransferOrderItem        : String(6);          // 调拨单行项目
    PostingDate                  : Date;               // 过账日期
    GoodsMovementCode            : String(3);          // 移动类型代码
    Customer                     : String(10);         // 客户
    Material                     : String(40);         // 物料编号
    Plant                        : String(4);          // 发出工厂
    StorageLocation              : String(4);          // 库存地点
    GoodsMovementType            : String(3) ;         // 移动类型
    QuantityInBaseUnit           : Decimal(13,3);      // 数量
    IssuingOrReceivingStorageLoc : String(4);          // 收货/发货库存地点
    zrfcid                       : String(10);         // 业务流程ID
    zrfc_logid                   : UUID;               // 多步ID
}

//销售出库单
entity OutboundDelivery{
    key SalesOrder           : String(10);         // 销售出库单号
    key SalesOrderItem       : String(6);          // 销售出库单行号
    SalesOrganization        : String(4);          // 销售组织
    SalesOrderType           : String(4);          // 销售订单类型
    SalesOrderDate           : Date;               // 订单日期
    Customer                 : String(10);         // 客户
    SalesOffice              : String(2);          // 销售部门
    TransactionCurrency      : String(3);          // 币别
    Country                  : String(3);          // 国家
    Product                  : String(40);         // 物料编码
    SalesOrderItemType       : String(5);          // 行项目类别
    NetAmount                : Decimal(13,3);      // 总金额
    RequestedQuantity        : Decimal(13,3);      // 总数量
    ItemTransactionCurrency  : String(3);          // 币别
    ReceivingPlant           : String(4);          // 库存组织
    ReceivingStorageLocation : String(4);          // 库存地点
    DeliveryDate             : Date;               // 发货日期
    zrfcid                   : String(10);         // 业务流程ID
    zrfc_logid               : UUID;               // 多步ID
}

//收付款单
entity PaymentReceipt {
    key paymentReceiptNo        : String(20);     // 单据编号  
    key paymentReceiptNoItem    : String(6);      // 单据行号    
    settlementOrganization      : String(4);      // 结算组织
    salesOrganization           : String(4);      // 销售组织
    procurementOrganization     : String(4);      // 采购组织
    paymentOrganization         : String(4);      // 付款组织
    receivingOrganization       : String(32);     // 收款组织
    procurementDepartment       : String(32);     // 采购部门
    salesDepartment             : String(32);     // 销售部门
    expenseResponsibleDepartment: String(32);     // 费用承担部门
    currency                    : String(3) ;     // 币别        
    businessDate                : Date;           // 业务日期
    documentType                : String(20);     // 单据类型
    businessType                : String(20);     // 业务类型
    settlementMethod            : String(20);     // 结算方式
    paymentPurpose              : String(50);     // 收付款用途
    receivingUnitType           : String(10);     // 收款单位类型
    receivingUnit               : String(32);     // 收款单位
    payingUnitType              : String(10);     // 付款单位类型
    payingUnit                  : String(32);     // 付款单位
    receivableAmount            : Decimal(15,2);  // 应收金额  
    taxRate                     : Decimal(5,2);   // 税率      
    ourBankAccount              : String(50);     // 我方银行账号
    generalLedgerAccountCash    : String(20);     // 总账科目（资金科目）
    generalLedgerAccountNonCash : String(20) ;    // 总账科目（非资金科目）
    expenseItem                 : String(32);     // 费用项目     
    itemRemark                  : String(50);     // 明细备注   
    zrfcid                      : String(10);     // 业务流程ID
    zrfc_logid                  : UUID;           // 多步ID
}

//销售订单创建表
entity SalesOrderCreate {
    key PISalesOrder              : String(10);    // PI销售订单号
    key PISalesOrderItem          : String(6);     // PI销售订单项目号
    SalesOrderType                : String(4);     // 销售订单类型
    SalesOrganization             : String(4);     // 销售组织
    DistributionChannel           : String(2);     // 分销渠道
    OrganizationDivision          : String(2);     // 产品组
    SalesOffice                   : String(10);    // 销售办事处
    SalesGroup                    : String(10);    // 销售组
    SalesDistrict                 : String(20);    // 售达方
    PurchaseOrderByCustomer       : String(50);    // 客户参考编号
    CustomerPurchaseOrderDate     : Date;          // 客户参考日期
    TransactionCurrency           : String(3);     // 凭证币别
    SDDocumentReason              : String(4);     // 订单原因
    RequestedDeliveryDate         : Date;          // 请求交货日期
    CustomerAccountAssignmentGroup: String(4);     // 客户账户分配组
    IncotermsClassification       : String(10);    // 国际贸易条款
    IncotermsLocation1            : String(40);    // 国贸条款位置1
    CustomerTaxClassification1    : String(4);     // 客户税分类
    CustomerPaymentTerms          : String(8);     // 付款条件
    Remark                        : LargeString;   // 销售订单抬头文本备注
    YY1_FD_XMYQ                   : LargeString;   // 箱唛要求
    YY1_FD_DBFS                   : String(20);    // 打包方式
    YY1_FD_FHYQ                   : LargeString;   // 发货要求
    YY1_FD_FKG                    : String(20);    // 付款国
    YY1_FD_JSFS                   : String(20);    // 结算方式
    YY1_FD_PT                     : String(20);    // 平台
    YY1_FD_SFBG                   : Boolean;       // 是否报关
    YY1_FD_SFHD                   : Boolean;       // 是否回单
    YY1_FD_TMBQ                   : String(50);    // 条码标签
    YY1_FD_YDG                    : String(20);    // 运抵国
    YY1_FD_YSFS                   : String(20);    // 运输方式
    YY1_FD_ZTMWZ                  : Boolean;       // 粘贴美文纸
    YY1_FD_ZH                     : String(50);    // 账户(下单店铺)
    YY1_FD_ZDFJY                  : String(10);    // 多方交易类型
    SalesOrderItemCategory        : String(8);     // 销售订单项目类别
    Material                      : String(40);    // 物料号
    MaterialByCustomer            : String(50);    // 客户物料编号
    RequestedQuantity             : Decimal(15,3); // 数量
    RequestedQuantityUnit         : String(3);     // 单位
    ProductionPlant               : String(4);     // 工厂
    ItemRemark                    : LargeString;   // 销售订单行项目文本备注
    PurchaseOrderByShipToParty    : String(50);    // 客户采购订单行项目
    ProductTaxClassification1     : String(4);     // 产品税分类
    SalesDocumentRjcnReason       : String(4);     // 销售订单拒绝原因
    YY1_FD_FNSKU                  : String(50);    // FNSKU/快递袋编码
    YY1_FD_SKU                    : String(50);    // 客户SKU
    ZB01_Value                    : Decimal(15,2); // ZB01价格
    ZB01_CurrencyCode             : Integer;       // ZB01价格单位
    ZB01_UnitOfMeasure            : Integer;       // ZB01数量单位
    ZB02_Value                    : Decimal(15,2); // ZB02价格
    ZB02_CurrencyCode             : Integer;       // ZB02价格单位
    ZB02_UnitOfMeasure            : Integer;       // ZB02数量单位
    ZB03_Value                    : Decimal(15,2); // ZB03价格
    ZB03_CurrencyCode             : Integer;       // ZB03价格单位
    ZB03_UnitOfMeasure            : Integer;       // ZB03数量单位
    ZB04_Value                    : Decimal(15,2); // ZB04价格
    ZB04_CurrencyCode             : Integer;       // ZB04价格单位
    ZB04_UnitOfMeasure            : Integer;       // ZB04数量单位
    ZC01_Value                    : Decimal(15,2); // ZC01价格
    ZC01_CurrencyCode             : Integer;       // ZC01价格单位
    ZC01_UnitOfMeasure            : Integer;       // ZC01数量单位
    ZC02_Value                    : Decimal(15,2); // ZC02价格
    ZC02_CurrencyCode             : Integer;       // ZC02价格单位
    ZC02_UnitOfMeasure            : Integer;       // ZC02数量单位
    ZP00_Value                    : Decimal(15,2); // ZP00价格
    ZP00_CurrencyCode             : Integer;       // ZP00价格单位
    ZP00_UnitOfMeasure            : Integer;       // ZP00数量单位
    PartnerFunction               : String(8);     // 合作伙伴功能
    Customer                      : String(20);    // 合作伙伴编号
    ConfirmedDeliveryDate         : Date;          // 交货日期
    ScheduleLineOrderQuantity     : Decimal(15,3); // 订单确认数量
    zrfcid                        : String(10);     // 业务流程ID
    zrfc_logid                    : UUID;           // 多步ID
}

// 销售订单行项目表
entity SalesOrderChange {
    key SalesOrder                : String(10);     // 销售订单号
    key SalesOrderItem            : String(6);      // 销售订单项目号
    SalesOrderItemCategory        : String(8);      // 销售订单项目类别
    Material                      : String(40);     // 物料号
    MaterialByCustomer            : String(50);     // 客户物料编号
    RequestedQuantity             : Decimal(15,3);  // 数量
    RequestedQuantityUnit         : String(3);      // 单位
    ProductionPlant               : String(4);      // 工厂
    ZB01_Value                    : Decimal(15,2);  // ZB01价格
    ZB01_CurrencyCode             : Integer;        // ZB01价格单位
    ZB01_UnitOfMeasure            : Integer;        // ZB01数量单位
    ZB02_Value                    : Decimal(15,2);  // ZB02价格
    ZB02_CurrencyCode             : Integer;        // ZB02价格单位
    ZB02_UnitOfMeasure            : Integer;        // ZB02数量单位
    ZB03_Value                    : Decimal(15,2);  // ZB03价格
    ZB03_CurrencyCode             : Integer;        // ZB03价格单位
    ZB03_UnitOfMeasure            : Integer;        // ZB03数量单位
    ZB04_Value                    : Decimal(15,2);  // ZB04价格
    ZB04_CurrencyCode             : Integer;        // ZB04价格单位
    ZB04_UnitOfMeasure            : Integer;        // ZB04数量单位
    ZC01_Value                    : Decimal(15,2);  // ZC01价格
    ZC01_CurrencyCode             : Integer;        // ZC01价格单位
    ZC01_UnitOfMeasure            : Integer;        // ZC01数量单位
    ZC02_Value                    : Decimal(15,2);  // ZC02价格
    ZC02_CurrencyCode             : Integer;        // ZC02价格单位
    ZC02_UnitOfMeasure            : Integer;        // ZC02数量单位
    ZP00_Value                    : Decimal(15,2);  // ZP00价格
    ZP00_CurrencyCode             : Integer;        // ZP00价格单位
    ZP00_UnitOfMeasure            : Integer;        // ZP00数量单位
    YY1_FD_FNSKU                  : String(50);     // FNSKU/快递袋编码
    YY1_FD_SKU                    : String(50);     // 客户SKU
    ConfirmedDeliveryDate         : Date;           // 交货日期
    ScheduleLineOrderQuantity     : Decimal(15,3);  // 订单确认数量
    SalesDocumentRjcnReason       : String(4);      // 销售订单拒绝原因
}