using ReportService as service from '../../../srv/ReportService';
annotate service.SDDocRel with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: SalesOrder },
            Description: { $Type: 'UI.DataField', Value: SalesOrderItem },
            TypeName: '数帝单据关系表',
            TypeNamePlural: '数帝单据关系列表'
        },
        // 搜索筛选字段，按需挑选核心单据号放这里
        SelectionFields: [
            SalesOrder,
            SalesOrderItem,
            ExternalSalesOrder,
            InterCompanyPurchaseOrder,
            InterCompanyOutboundDelivery,
            InterCompanyInboundDelivery,
            ExternalOutboundDelivery,
            zrfcid,
            zrfc_logid
        ],
        // 列表行展示字段（Table行）
        LineItem: [
            { $Type: 'UI.DataField', Label: '销售出库单号', Value: SalesOrder },
            { $Type: 'UI.DataField', Label: '销售出库单行号', Value: SalesOrderItem },
            { $Type: 'UI.DataField', Label: '对外销售订单号', Value: ExternalSalesOrder },
            { $Type: 'UI.DataField', Label: '对外销售订单行号', Value: ExternalSalesOrderItem },
            { $Type: 'UI.DataField', Label: '公司间采购订单号', Value: InterCompanyPurchaseOrder },
            { $Type: 'UI.DataField', Label: '公司间采购订单行号', Value: InterCompanyPurchaseOrderItem },
            { $Type: 'UI.DataField', Label: '公司间外向交货单号', Value: InterCompanyOutboundDelivery },
            { $Type: 'UI.DataField', Label: '公司间外向交货单行号', Value: InterCompanyOutboundDeliveryItem },
            { $Type: 'UI.DataField', Label: '公司间内向交货单号', Value: InterCompanyInboundDelivery },
            { $Type: 'UI.DataField', Label: '公司间内向交货单行号', Value: InterCompanyInboundDeliveryItem },
            { $Type: 'UI.DataField', Label: '对外外向交货单号', Value: ExternalOutboundDelivery },
            { $Type: 'UI.DataField', Label: '对外外向交货单行号', Value: ExternalOutboundDeliveryItem },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid }
        ],
        // 详情页面Identification区块（基本信息）
        Identification: [
            { $Type: 'UI.DataField', Label: '销售出库单号', Value: SalesOrder },
            { $Type: 'UI.DataField', Label: '销售出库单行号', Value: SalesOrderItem },
            { $Type: 'UI.DataField', Label: '对外销售订单号', Value: ExternalSalesOrder },
            { $Type: 'UI.DataField', Label: '对外销售订单行号', Value: ExternalSalesOrderItem },
            { $Type: 'UI.DataField', Label: '公司间采购订单号', Value: InterCompanyPurchaseOrder },
            { $Type: 'UI.DataField', Label: '公司间采购订单行号', Value: InterCompanyPurchaseOrderItem },
            { $Type: 'UI.DataField', Label: '公司间外向交货单号', Value: InterCompanyOutboundDelivery },
            { $Type: 'UI.DataField', Label: '公司间外向交货单行号', Value: InterCompanyOutboundDeliveryItem },
            { $Type: 'UI.DataField', Label: '公司间内向交货单号', Value: InterCompanyInboundDelivery },
            { $Type: 'UI.DataField', Label: '公司间内向交货单行号', Value: InterCompanyInboundDeliveryItem },
            { $Type: 'UI.DataField', Label: '对外外向交货单号', Value: ExternalOutboundDelivery },
            { $Type: 'UI.DataField', Label: '对外外向交货单行号', Value: ExternalOutboundDeliveryItem },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' }
        ]
    }
);