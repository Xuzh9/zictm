using { com.sap.zictm as db } from '../db/schema';  

service ReportService {
    /**
     * PI销售订单关系表
     */
    @readonly
    entity PISalesOrderRel as select from db.PISalesOrderRel
        left outer join db.SalesOrderCreate
            on PISalesOrderRel.PIOrder = SalesOrderCreate.PIOrder
            and PISalesOrderRel.PIOrderItem = SalesOrderCreate.PIOrderItem
        left outer join db.MultistepHeadLog
            on PISalesOrderRel.zrfc_logid = MultistepHeadLog.zrfc_logid
        {
            key PISalesOrderRel.PIOrder,
            key PISalesOrderRel.PIOrderItem,
            PISalesOrderRel.zrfc_logid,
            PISalesOrderRel.SalesOrder,
            PISalesOrderRel.SalesOrderItem,
            PISalesOrderRel.PurchaseOrder1,
            PISalesOrderRel.PurchaseOrderItem1,
            PISalesOrderRel.SalesOrder1,
            PISalesOrderRel.SalesOrderItem1,
            PISalesOrderRel.PurchaseOrder2,
            PISalesOrderRel.PurchaseOrderItem2,
            PISalesOrderRel.SalesOrder2,
            PISalesOrderRel.SalesOrderItem2,
            PISalesOrderRel.ProductionOrder,
            SalesOrderCreate.zrfcid,
            SalesOrderCreate.zdfjy,
            MultistepHeadLog.code,
            MultistepHeadLog.message
        };
    
    /**
     * PI交货单关系表
     */
    @readonly
    entity PIDeliveryRel as select from db.PIDeliveryRel
        left outer join db.DeliveryActualInfo
            on PIDeliveryRel.DeliveryDocument = DeliveryActualInfo.DeliveryDocument
            and PIDeliveryRel.DeliveryDocumentItem = DeliveryActualInfo.DeliveryDocumentItem
        left outer join db.MultistepHeadLog
            on PIDeliveryRel.zrfc_logid = MultistepHeadLog.zrfc_logid
        {
            key PIDeliveryRel.PIOrder,
            key PIDeliveryRel.PIOrderItem,
            key PIDeliveryRel.DeliveryDocument,
            key PIDeliveryRel.DeliveryDocumentItem,
            PIDeliveryRel.ParentItem,
            PIDeliveryRel.zrfc_logid,
            PIDeliveryRel.SalesOrderType,
            PIDeliveryRel.DeliveryNo1,
            PIDeliveryRel.DeliveryNoItem1,
            PIDeliveryRel.InboundDeliveryNo1,
            PIDeliveryRel.InboundDeliveryNoItem1,
            PIDeliveryRel.DeliveryNo2,
            PIDeliveryRel.DeliveryNoItem2,
            PIDeliveryRel.InboundDeliveryNo2,
            PIDeliveryRel.InboundDeliveryNoItem2,
            DeliveryActualInfo.zrfcid,
            MultistepHeadLog.code,
            MultistepHeadLog.message
        };

    /**
     * 调拨单
     */
    @readonly
    entity Transfer as select from db.Transfer
        left outer join db.MultistepHeadLog
            on Transfer.zrfc_logid = MultistepHeadLog.zrfc_logid
        {
            key Transfer.TransferOrder,
            key Transfer.TransferOrderItem,
            Transfer.PostingDate,
            Transfer.GoodsMovementCode,
            Transfer.Customer,
            Transfer.Material,
            Transfer.Plant,
            Transfer.StorageLocation,
            Transfer.GoodsMovementType,
            Transfer.QuantityInBaseUnit,
            Transfer.IssuingOrReceivingStorageLoc,
            Transfer.zrfcid,
            Transfer.zrfc_logid,
            MultistepHeadLog.code,
            MultistepHeadLog.message
        };

    /**
     * 销售出库单
     */
    @readonly
    entity OutboundDelivery as select from db.OutboundDelivery
        left outer join db.MultistepHeadLog
            on OutboundDelivery.zrfc_logid = MultistepHeadLog.zrfc_logid
        {
            key OutboundDelivery.SalesOrder,
            key OutboundDelivery.SalesOrderItem,
            OutboundDelivery.SalesOrganization,
            OutboundDelivery.SalesOrderType,
            OutboundDelivery.SalesOrderDate,
            OutboundDelivery.Customer,
            OutboundDelivery.SalesOffice,
            OutboundDelivery.TransactionCurrency,
            OutboundDelivery.Country,
            OutboundDelivery.Product,
            OutboundDelivery.SalesOrderItemType,
            OutboundDelivery.NetAmount,
            OutboundDelivery.RequestedQuantity,
            OutboundDelivery.RequestedQuantityUnit,
            OutboundDelivery.ItemTransactionCurrency,
            OutboundDelivery.ReceivingPlant,
            OutboundDelivery.ReceivingStorageLocation,
            OutboundDelivery.DeliveryDate,
            OutboundDelivery.PurchasePrice,
            OutboundDelivery.zrfcid,
            OutboundDelivery.zrfc_logid,
            OutboundDelivery.zdfjy,
            MultistepHeadLog.code,
            MultistepHeadLog.message
        };

    /**
     * 收付款单
     */
    @readonly
    entity PaymentReceipt as select from db.PaymentReceipt
        left outer join db.MultistepHeadLog
            on PaymentReceipt.zrfc_logid = MultistepHeadLog.zrfc_logid
        {
            key PaymentReceipt.paymentReceiptNo,
            key PaymentReceipt.paymentReceiptNoItem,
            PaymentReceipt.settlementOrganization,
            PaymentReceipt.salesOrganization,
            PaymentReceipt.procurementOrganization,
            PaymentReceipt.receivingOrganization,
            PaymentReceipt.expenseResponsibleDepartment,
            PaymentReceipt.currency,
            PaymentReceipt.businessDate,
            PaymentReceipt.documentType,
            PaymentReceipt.businessType,
            PaymentReceipt.remark,
            PaymentReceipt.settlementMethod,
            PaymentReceipt.paymentPurpose,
            PaymentReceipt.receivingUnitType,
            PaymentReceipt.receivingUnit,
            PaymentReceipt.receivableAmount,
            PaymentReceipt.taxRate,
            PaymentReceipt.ourBankAccount,
            PaymentReceipt.generalLedgerAccountCash,
            PaymentReceipt.generalLedgerAccountNonCash,
            PaymentReceipt.expenseItem,
            PaymentReceipt.itemRemark,
            PaymentReceipt.documentName,
            PaymentReceipt.incomeExpenseType,
            PaymentReceipt.financialTransactionType,
            PaymentReceipt.AccountingDocument,
            PaymentReceipt.zrfcid,
            PaymentReceipt.zrfc_logid,
            MultistepHeadLog.code,
            MultistepHeadLog.message
        };

    /**
     * 销售订单创建表
     */
    @readonly
    entity SalesOrderCreate as select from db.SalesOrderCreate
        left outer join db.MultistepHeadLog
            on SalesOrderCreate.zrfc_logid = MultistepHeadLog.zrfc_logid
        {
            key SalesOrderCreate.PIOrder,
            key SalesOrderCreate.PIOrderItem,
            SalesOrderCreate.SalesOrderType,
            SalesOrderCreate.SalesOrganization,
            SalesOrderCreate.DistributionChannel,
            SalesOrderCreate.OrganizationDivision,
            SalesOrderCreate.SalesOffice,
            SalesOrderCreate.SalesGroup,
            SalesOrderCreate.SalesDistrict,
            SalesOrderCreate.PurchaseOrderByCustomer,
            SalesOrderCreate.CustomerPurchaseOrderDate,
            SalesOrderCreate.TransactionCurrency,
            SalesOrderCreate.SDDocumentReason,
            SalesOrderCreate.RequestedDeliveryDate,
            SalesOrderCreate.CustomerAccountAssignmentGroup,
            SalesOrderCreate.IncotermsClassification,
            SalesOrderCreate.IncotermsLocation1,
            SalesOrderCreate.CustomerTaxClassification1,
            SalesOrderCreate.CustomerPaymentTerms,
            SalesOrderCreate.Remark,
            SalesOrderCreate.YY1_FD_XMYQ,
            SalesOrderCreate.YY1_FD_DBFS,
            SalesOrderCreate.YY1_FD_FHYQ,
            SalesOrderCreate.YY1_FD_FKG,
            SalesOrderCreate.YY1_FD_JSFS,
            SalesOrderCreate.YY1_FD_PT,
            SalesOrderCreate.YY1_FD_SFBG,
            SalesOrderCreate.YY1_FD_SFHD,
            SalesOrderCreate.YY1_FD_TMBQ,
            SalesOrderCreate.YY1_FD_YDG,
            SalesOrderCreate.YY1_FD_YSFS,
            SalesOrderCreate.YY1_FD_ZTMWZ,
            SalesOrderCreate.YY1_FD_ZH,
            SalesOrderCreate.YY1_FD_ZDFJY,
            SalesOrderCreate.YY1_FD_SPLLHH,
            SalesOrderCreate.YY1_FD_XMZL,
            SalesOrderCreate.SalesOrderItemCategory,
            SalesOrderCreate.Material,
            SalesOrderCreate.MaterialByCustomer,
            SalesOrderCreate.RequestedQuantity,
            SalesOrderCreate.RequestedQuantityUnit,
            SalesOrderCreate.ProductionPlant,
            SalesOrderCreate.StorageLocation,
            SalesOrderCreate.ItemRemark,
            SalesOrderCreate.PurchaseOrderByShipToParty,
            SalesOrderCreate.ProductTaxClassification1,
            SalesOrderCreate.SalesDocumentRjcnReason,
            SalesOrderCreate.YY1_FD_FNSKU,
            SalesOrderCreate.YY1_FD_SKU,
            SalesOrderCreate.YY1_FD_DZKB,
            SalesOrderCreate.PurchasePrice,
            SalesOrderCreate.ZB01_Value,
            SalesOrderCreate.ZB01_CurrencyCode,
            SalesOrderCreate.ZB01_UnitOfMeasure,
            SalesOrderCreate.ZB02_Value,
            SalesOrderCreate.ZB02_CurrencyCode,
            SalesOrderCreate.ZB02_UnitOfMeasure,
            SalesOrderCreate.ZB03_Value,
            SalesOrderCreate.ZB03_CurrencyCode,
            SalesOrderCreate.ZB03_UnitOfMeasure,
            SalesOrderCreate.ZB04_Value,
            SalesOrderCreate.ZB04_CurrencyCode,
            SalesOrderCreate.ZB04_UnitOfMeasure,
            SalesOrderCreate.ZC01_Value,
            SalesOrderCreate.ZC01_CurrencyCode,
            SalesOrderCreate.ZC01_UnitOfMeasure,
            SalesOrderCreate.ZC02_Value,
            SalesOrderCreate.ZC02_CurrencyCode,
            SalesOrderCreate.ZC02_UnitOfMeasure,
            SalesOrderCreate.ZP00_Value,
            SalesOrderCreate.ZP00_CurrencyCode,
            SalesOrderCreate.ZP00_UnitOfMeasure,
            SalesOrderCreate.PartnerFunction,
            SalesOrderCreate.Customer,
            SalesOrderCreate.ProductionStartDate,
            SalesOrderCreate.ConfirmedDeliveryDate,
            SalesOrderCreate.ScheduleLineOrderQuantity,
            SalesOrderCreate.zrfcid,
            SalesOrderCreate.zrfc_logid,
            SalesOrderCreate.zdfjy,
            MultistepHeadLog.code,
            MultistepHeadLog.message
        };

    /**
     * 销售订单修改表
     */
    @readonly
    entity SalesOrderChange as select from db.SalesOrderChange
        left outer join db.MultistepHeadLog
            on SalesOrderChange.zrfc_logid = MultistepHeadLog.zrfc_logid
        {
            key SalesOrderChange.PIOrder,
            key SalesOrderChange.PIOrderItem,
            SalesOrderChange.SalesOrderItemCategory,
            SalesOrderChange.Material,
            SalesOrderChange.MaterialByCustomer,
            SalesOrderChange.RequestedQuantity,
            SalesOrderChange.RequestedQuantityUnit,
            SalesOrderChange.ProductionPlant,
            SalesOrderChange.StorageLocation,
            SalesOrderChange.PurchasePrice,
            SalesOrderChange.ZB01_Value,
            SalesOrderChange.ZB01_CurrencyCode,
            SalesOrderChange.ZB01_UnitOfMeasure,
            SalesOrderChange.ZB02_Value,
            SalesOrderChange.ZB02_CurrencyCode,
            SalesOrderChange.ZB02_UnitOfMeasure,
            SalesOrderChange.ZB03_Value,
            SalesOrderChange.ZB03_CurrencyCode,
            SalesOrderChange.ZB03_UnitOfMeasure,
            SalesOrderChange.ZB04_Value,
            SalesOrderChange.ZB04_CurrencyCode,
            SalesOrderChange.ZB04_UnitOfMeasure,
            SalesOrderChange.ZC01_Value,
            SalesOrderChange.ZC01_CurrencyCode,
            SalesOrderChange.ZC01_UnitOfMeasure,
            SalesOrderChange.ZC02_Value,
            SalesOrderChange.ZC02_CurrencyCode,
            SalesOrderChange.ZC02_UnitOfMeasure,
            SalesOrderChange.ZP00_Value,
            SalesOrderChange.ZP00_CurrencyCode,
            SalesOrderChange.ZP00_UnitOfMeasure,
            SalesOrderChange.YY1_FD_FNSKU,
            SalesOrderChange.YY1_FD_SKU,
            SalesOrderChange.YY1_FD_DZKB,
            SalesOrderChange.ProductionStartDate,
            SalesOrderChange.ConfirmedDeliveryDate,
            SalesOrderChange.ScheduleLineOrderQuantity,
            SalesOrderChange.SalesDocumentRjcnReason,
            SalesOrderChange.zrfcid,
            SalesOrderChange.zrfc_logid,
            SalesOrderChange.zdfjy,
            MultistepHeadLog.code,
            MultistepHeadLog.message
        };

    /**
     * 交货单表
     */
    @readonly
    entity DeliveryActualInfo as select from db.DeliveryActualInfo
        left outer join db.MultistepHeadLog
            on DeliveryActualInfo.zrfc_logid = MultistepHeadLog.zrfc_logid
        {
            key DeliveryActualInfo.DeliveryDocument,
            key DeliveryActualInfo.DeliveryDocumentItem,
            DeliveryActualInfo.ActualGoodsMovementDate,
            DeliveryActualInfo.YY1_FD_SPZT,
            DeliveryActualInfo.Material,
            DeliveryActualInfo.StorageLocation,
            DeliveryActualInfo.ActualDeliveryQuantity,
            DeliveryActualInfo.Batch,
            DeliveryActualInfo.ParentItem,
            DeliveryActualInfo.RefDocNo,
            DeliveryActualInfo.RefDocItem,
            DeliveryActualInfo.zrfcid,
            DeliveryActualInfo.zrfc_logid,
            MultistepHeadLog.code,
            MultistepHeadLog.message
        };

    /**
     * PI调拨单
     */
    @readonly
    entity PITransfer as select from db.PITransfer
        left outer join db.MultistepHeadLog
            on PITransfer.zrfc_logid = MultistepHeadLog.zrfc_logid
        {
            key PITransfer.PIOrder,
            key PITransfer.PIOrderItem,
            key PITransfer.ID,
            PITransfer.PostingDate,
            PITransfer.GoodsMovementCode,
            PITransfer.Material,
            PITransfer.Plant,
            PITransfer.StorageLocation,
            PITransfer.GoodsMovementType,
            PITransfer.QuantityInBaseUnit,
            PITransfer.IssuingOrReceivingStorageLoc,
            PITransfer.UnloadingPointName,
            PITransfer.zrfcid,
            PITransfer.zrfc_logid,
            MultistepHeadLog.code,
            MultistepHeadLog.message
        };
}