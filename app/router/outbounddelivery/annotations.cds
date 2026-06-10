using ReportService as service from '../../../srv/ReportService';
annotate service.OutboundDelivery with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: SalesOrder },
            Description: { $Type: 'UI.DataField', Value: SalesOrderItem },
            TypeName: '销售出库单',
            TypeNamePlural: '销售出库单列表'
        },
        SelectionFields: [SalesOrder,Customer,Product,SalesOrganization,SalesOffice,zrfcid,zrfc_logid],
        LineItem: [
            { $Type: 'UI.DataField', Label: '销售出库单号', Value: SalesOrder },
            { $Type: 'UI.DataField', Label: '销售出库单行号', Value: SalesOrderItem },
            { $Type: 'UI.DataField', Label: '销售组织', Value: SalesOrganization },
            { $Type: 'UI.DataField', Label: '销售订单类型', Value: SalesOrderType },
            { $Type: 'UI.DataField', Label: '订单日期', Value: SalesOrderDate },
            { $Type: 'UI.DataField', Label: '客户', Value: Customer },
            { $Type: 'UI.DataField', Label: '销售部门', Value: SalesOffice },
            { $Type: 'UI.DataField', Label: '币别', Value: TransactionCurrency },
            { $Type: 'UI.DataField', Label: '国家', Value: Country },
            { $Type: 'UI.DataField', Label: '物料编码', Value: Product },
            { $Type: 'UI.DataField', Label: '行项目类别', Value: SalesOrderItemType },
            { $Type: 'UI.DataField', Label: '总金额', Value: NetAmount },
            { $Type: 'UI.DataField', Label: '总数量', Value: RequestedQuantity },
            { $Type: 'UI.DataField', Label: '单位', Value: RequestedQuantityUnit },
            { $Type: 'UI.DataField', Label: '行项目币别', Value: ItemTransactionCurrency },
            { $Type: 'UI.DataField', Label: '库存组织', Value: ReceivingPlant },
            { $Type: 'UI.DataField', Label: '库存地点', Value: ReceivingStorageLocation },
            { $Type: 'UI.DataField', Label: '发货日期', Value: DeliveryDate },
            { $Type: 'UI.DataField', Label: '采购单价', Value: PurchasePrice },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid },
            { $Type: 'UI.DataField', Label: '多方交易类型ID', Value: zdfjy }
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: '销售出库单号', Value: SalesOrder },
            { $Type: 'UI.DataField', Label: '销售出库单行号', Value: SalesOrderItem },
            { $Type: 'UI.DataField', Label: '销售组织', Value: SalesOrganization },
            { $Type: 'UI.DataField', Label: '销售订单类型', Value: SalesOrderType },
            { $Type: 'UI.DataField', Label: '订单日期', Value: SalesOrderDate },
            { $Type: 'UI.DataField', Label: '客户', Value: Customer },
            { $Type: 'UI.DataField', Label: '销售部门', Value: SalesOffice },
            { $Type: 'UI.DataField', Label: '币别', Value: TransactionCurrency },
            { $Type: 'UI.DataField', Label: '国家', Value: Country },
            { $Type: 'UI.DataField', Label: '物料编码', Value: Product },
            { $Type: 'UI.DataField', Label: '行项目类别', Value: SalesOrderItemType },
            { $Type: 'UI.DataField', Label: '总金额', Value: NetAmount },
            { $Type: 'UI.DataField', Label: '总数量', Value: RequestedQuantity },
            { $Type: 'UI.DataField', Label: '单位', Value: RequestedQuantityUnit },
            { $Type: 'UI.DataField', Label: '行项目币别', Value: ItemTransactionCurrency },
            { $Type: 'UI.DataField', Label: '库存组织', Value: ReceivingPlant },
            { $Type: 'UI.DataField', Label: '库存地点', Value: ReceivingStorageLocation },
            { $Type: 'UI.DataField', Label: '发货日期', Value: DeliveryDate },
            { $Type: 'UI.DataField', Label: '采购单价', Value: PurchasePrice },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid },
            { $Type: 'UI.DataField', Label: '多方交易类型ID', Value: zdfjy }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' }
        ]
    }
);