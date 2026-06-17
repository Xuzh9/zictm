using ReportService as service from '../../../srv/ReportService';
annotate service.PISalesOrderRel with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: PIOrder },
            Description: { $Type: 'UI.DataField', Value: PIOrderItem },
            TypeName: 'PI销售订单关系表',
            TypeNamePlural: 'PI销售订单关系列表'
        },
        SelectionFields: [PIOrder,SalesOrder,PurchaseOrder1,SalesOrder1,PurchaseOrder2,SalesOrder2,ProductionOrder,code],
        LineItem: [
            { $Type: 'UI.DataField', Label: 'PI单号', Value: PIOrder },
            { $Type: 'UI.DataField', Label: 'PI单行号', Value: PIOrderItem },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多方交易类型ID', Value: zdfjy },
            { $Type: 'UI.DataField', Label: '对外销售订单号', Value: SalesOrder },
            { $Type: 'UI.DataField', Label: '对外销售订单行号', Value: SalesOrderItem },
            { $Type: 'UI.DataField', Label: '采购订单号1', Value: PurchaseOrder1 },
            { $Type: 'UI.DataField', Label: '采购订单行号1', Value: PurchaseOrderItem1 },
            { $Type: 'UI.DataField', Label: '销售订单号1', Value: SalesOrder1 },
            { $Type: 'UI.DataField', Label: '销售订单行号1', Value: SalesOrderItem1 },
            { $Type: 'UI.DataField', Label: '生产订单', Value: ProductionOrder },
            { $Type: 'UI.DataField', Label: '消息状态', Value: code },
            { $Type: 'UI.DataField', Label: '消息文本', Value: message },
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: 'PI单号', Value: PIOrder },
            { $Type: 'UI.DataField', Label: 'PI单行号', Value: PIOrderItem },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多方交易类型ID', Value: zdfjy },
            { $Type: 'UI.DataField', Label: '对外销售订单号', Value: SalesOrder },
            { $Type: 'UI.DataField', Label: '对外销售订单行号', Value: SalesOrderItem },
            { $Type: 'UI.DataField', Label: '采购订单号1', Value: PurchaseOrder1 },
            { $Type: 'UI.DataField', Label: '采购订单行号1', Value: PurchaseOrderItem1 },
            { $Type: 'UI.DataField', Label: '销售订单号1', Value: SalesOrder1 },
            { $Type: 'UI.DataField', Label: '销售订单行号1', Value: SalesOrderItem1 },
            { $Type: 'UI.DataField', Label: '采购订单号2', Value: PurchaseOrder2 },
            { $Type: 'UI.DataField', Label: '采购订单行号2', Value: PurchaseOrderItem2 },
            { $Type: 'UI.DataField', Label: '销售订单号2', Value: SalesOrder2 },
            { $Type: 'UI.DataField', Label: '销售订单行号2', Value: SalesOrderItem2 },
            { $Type: 'UI.DataField', Label: '生产订单', Value: ProductionOrder },
            { $Type: 'UI.DataField', Label: '消息状态', Value: code },
            { $Type: 'UI.DataField', Label: '消息文本', Value: message },
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' }
        ]
    }
);

