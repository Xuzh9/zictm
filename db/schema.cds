namespace com.sap.zictm;

type PriceDirection : String(1) enum {
    COST_FORWARD  @title: '成本正向' = 'A';
    PRICE_REVERSE @title: '销售价格逆向' = 'B';
};

type paymentType : String(2) enum {
    Income  @title: '收入' = '01';
    Expense @title: '支出' = '02';
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
    code           : String(2);      // 消息状态(S成功/E失败)
    message        : String(255);    // 消息文本
    objkey         : String(20);     // 对象号
    executionAt    : Timestamp;      // 执行时间
    executionTime  : Decimal(10,2);  // 运行时间（秒）
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
    key TransferOrder            : String(16);         // 调拨单
    key TransferOrderItem        : String(6);          // 调拨单行项目
    PostingDate                  : Date;               // 过账日期
    GoodsMovementCode            : String(3);          // 移动类型代码
    Customer                     : String(20);         // 客户
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
    key SalesOrder           : String(16);         // 销售出库单号
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
    key paymentReceiptNo        : String(16);     // 单据编号  
    key paymentReceiptNoItem    : String(6);      // 单据行号    
    settlementOrganization      : String(4);      // 结算组织
    salesOrganization           : String(4);      // 销售组织
    procurementOrganization     : String(4);      // 采购组织
    paymentOrganization         : String(4);      // 付款组织
    receivingOrganization       : String(32);     // 收款组织
    expenseResponsibleDepartment: String(32);     // 部门
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
    expenseItem                 : String(40);     // 费用项目     
    itemRemark                  : String(50);     // 明细备注   
    documentName                : String(10);     // 单据名称
    incomeExpenseType           : paymentType;    // 收支类型
    zrfcid                      : String(10);     // 业务流程ID
    zrfc_logid                  : UUID;           // 多步ID
}

//销售订单创建表
entity SalesOrderCreate {
    key PIOrder                   : String(10);    // PI单号
    key PIOrderItem               : String(6);     // PI项目号
    SalesOrderType                : String(4);     // 销售订单类型
    SalesOrganization             : String(4);     // 销售组织
    DistributionChannel           : String(2);     // 分销渠道
    OrganizationDivision          : String(2);     // 产品组
    SalesOffice                   : String(10);    // 销售办事处
    SalesGroup                    : String(10);    // 销售组
    SalesDistrict                 : String(10);    // 售达方
    PurchaseOrderByCustomer       : String(40);    // 客户参考编号
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
    YY1_FD_XMYQ                   : String(2);     // 箱唛要求
    YY1_FD_DBFS                   : String(2);     // 打包方式
    YY1_FD_FHYQ                   : String(2);     // 发货要求
    YY1_FD_FKG                    : String(3);     // 付款国
    YY1_FD_JSFS                   : String(4);     // 结算方式
    YY1_FD_PT                     : String(20);    // 平台
    YY1_FD_SFBG                   : String(2);     // 是否报关
    YY1_FD_SFHD                   : String(2);     // 是否回单
    YY1_FD_TMBQ                   : String(2) ;    // 条码标签
    YY1_FD_YDG                    : String(3);     // 运抵国
    YY1_FD_YSFS                   : String(2);     // 运输方式
    YY1_FD_ZTMWZ                  : String(2);     // 粘贴美文纸
    YY1_FD_ZH                     : String(20);    // 账户(下单店铺)
    YY1_FD_ZDFJY                  : String(10);    // 多方交易ID
    SalesOrderItemCategory        : String(4);     // 销售订单项目类别
    Material                      : String(40);    // 物料号
    MaterialByCustomer            : String(40);    // 客户物料编号
    RequestedQuantity             : Decimal(13,3); // 数量
    RequestedQuantityUnit         : String(3);     // 单位
    ProductionPlant               : String(4);     // 工厂
    ItemRemark                    : LargeString;   // 销售订单行项目文本备注
    PurchaseOrderByShipToParty    : String(6);     // 客户采购订单行项目
    ProductTaxClassification1     : String(4);     // 产品税分类
    SalesDocumentRjcnReason       : String(4);     // 销售订单拒绝原因
    YY1_FD_FNSKU                  : String(20);    // FNSKU/快递袋编码
    YY1_FD_SKU                    : String(30);    // 客户SKU
    ZB01_Value                    : Decimal(15,2); // ZB01价格
    ZB01_CurrencyCode             : String(3);     // ZB01价格单位
    ZB01_UnitOfMeasure            : Integer;       // ZB01数量单位
    ZB02_Value                    : Decimal(15,2); // ZB02价格
    ZB02_CurrencyCode             : String(3);     // ZB02价格单位
    ZB02_UnitOfMeasure            : Integer;       // ZB02数量单位
    ZB03_Value                    : Decimal(15,2); // ZB03价格
    ZB03_CurrencyCode             : String(3);     // ZB03价格单位
    ZB03_UnitOfMeasure            : Integer;       // ZB03数量单位
    ZB04_Value                    : Decimal(15,2); // ZB04价格
    ZB04_CurrencyCode             : String(3);     // ZB04价格单位
    ZB04_UnitOfMeasure            : Integer;       // ZB04数量单位
    ZC01_Value                    : Decimal(15,2); // ZC01价格
    ZC01_CurrencyCode             : String(3);     // ZC01价格单位
    ZC01_UnitOfMeasure            : Integer;       // ZC01数量单位
    ZC02_Value                    : Decimal(15,2); // ZC02价格
    ZC02_CurrencyCode             : String(3);     // ZC02价格单位
    ZC02_UnitOfMeasure            : Integer;       // ZC02数量单位
    ZP00_Value                    : Decimal(15,2); // ZP00价格
    ZP00_CurrencyCode             : String(3);     // ZP00价格单位
    ZP00_UnitOfMeasure            : Integer;       // ZP00数量单位
    PartnerFunction               : String(5);     // 合作伙伴功能
    Customer                      : String(10);    // 合作伙伴编号
    ConfirmedDeliveryDate         : Date;          // 交货日期
    ScheduleLineOrderQuantity     : Decimal(15,3); // 订单确认数量
    zrfcid                        : String(10);    // 业务流程ID
    zrfc_logid                    : UUID;          // 多步ID
}

// 销售订单修改表
entity SalesOrderChange {
    key SalesOrder                : String(10);     // 销售订单号
    key SalesOrderItem            : String(6);      // 销售订单项目号
    SalesOrderItemCategory        : String(4);      // 销售订单项目类别
    Material                      : String(40);     // 物料号
    MaterialByCustomer            : String(40);     // 客户物料编号
    RequestedQuantity             : Decimal(15,3);  // 数量
    RequestedQuantityUnit         : String(3);      // 单位
    ProductionPlant               : String(4);      // 工厂
    ZB01_Value                    : Decimal(15,2);  // ZB01价格
    ZB01_CurrencyCode             : String(3);      // ZB01价格单位
    ZB01_UnitOfMeasure            : Integer;        // ZB01数量单位
    ZB02_Value                    : Decimal(15,2);  // ZB02价格
    ZB02_CurrencyCode             : String(3);      // ZB02价格单位
    ZB02_UnitOfMeasure            : Integer;        // ZB02数量单位
    ZB03_Value                    : Decimal(15,2);  // ZB03价格
    ZB03_CurrencyCode             : String(3);      // ZB03价格单位
    ZB03_UnitOfMeasure            : Integer;        // ZB03数量单位
    ZB04_Value                    : Decimal(15,2);  // ZB04价格
    ZB04_CurrencyCode             : String(3);      // ZB04价格单位
    ZB04_UnitOfMeasure            : Integer;        // ZB04数量单位
    ZC01_Value                    : Decimal(15,2);  // ZC01价格
    ZC01_CurrencyCode             : String(3);      // ZC01价格单位
    ZC01_UnitOfMeasure            : Integer;        // ZC01数量单位
    ZC02_Value                    : Decimal(15,2);  // ZC02价格
    ZC02_CurrencyCode             : String(3);      // ZC02价格单位
    ZC02_UnitOfMeasure            : Integer;        // ZC02数量单位
    ZP00_Value                    : Decimal(15,2);  // ZP00价格
    ZP00_CurrencyCode             : String(3);      // ZP00价格单位
    ZP00_UnitOfMeasure            : Integer;        // ZP00数量单位
    YY1_FD_FNSKU                  : String(20);     // FNSKU/快递袋编码
    YY1_FD_SKU                    : String(30);     // 客户SKU
    ConfirmedDeliveryDate         : Date;           // 交货日期
    ScheduleLineOrderQuantity     : Decimal(13,3);  // 订单确认数量
    SalesDocumentRjcnReason       : String(4);      // 销售订单拒绝原因
    zrfcid                        : String(10);     // 业务流程ID
    zrfc_logid                    : UUID;           // 多步ID
}

//交货单表
entity DeliveryActualInfo {
    key DeliveryDocument      : String(10);      // 交货单
    key DeliveryDocumentItem  : String(6);       // 交货行项目
    ActualGoodsMovementDate   : Date;            // 实际发货日期
    YY1_FD_SPZT               : String(2);       // 财务审批状态
    Material                  : String(40);      // 物料编码
    ActualDeliveryQuantity    : Decimal(13,3);   // 实际发货数量
    StorageLocation           : String(4);       // 实际发货库位
    Batch                     : String(10);      // 实际批次
    ParentItem                : String(6);       // 上层行项目号
    RefDocNo                  : String(10);      // 参考单号
    RefDocItem                : String(6);       // 参考行项目号
    zrfcid                    : String(10);      // 业务流程ID
    zrfc_logid                : UUID;            // 多步ID
}

//PI销售订单关系表
entity PISalesOrderRel {
  key PIOrder                   : String(10);    // PI单号
  key PIOrderItem               : String(6);     // PI项目号
      SalesOrder                : String(10);    // 销售订单号
      SalesOrderItem            : String(6);     // 销售订单项目号
      PurchaseOrder1            : String(10);    // 采购订单号1
      PurchaseOrderItem1        : String(6);     // 采购订单项目号1
      SalesOrder1               : String(10);    // 销售订单号1
      SalesOrderItem1           : String(6);     // 销售订单项目号1
      PurchaseOrder2            : String(10);    // 采购订单号2
      PurchaseOrderItem2        : String(6);     // 采购订单项目号2
      SalesOrder2               : String(10);    // 销售订单号2
      SalesOrderItem2           : String(6);     // 销售订单项目号2
}

//PI交货单关系表
entity PIDeliveryRel {
  key PIOrder                   : String(10);    // PI单号
  key PIOrderItem               : String(6);     // PI项目号
      DeliveryNo1               : String(10);    // 交货单号1
      DeliveryNoItem1           : String(6);     // 交货单项目号1
      InboundDeliveryNo1        : String(10);    // 内向交货单号1
      InboundDeliveryNoItem1    : String(6);     // 内向交货项目号1
      DeliveryNo2               : String(10);    // 交货单号2
      DeliveryNoItem2           : String(6);     // 交货单项目号2
      InboundDeliveryNo2        : String(10);    // 内向交货号2
      InboundDeliveryNoItem2    : String(6);     // 内向交货项目号2
      DeliveryNo                : String(10);    // 销售订单号
      DeliveryNoItem            : String(6);     // 销售订单项目号
}