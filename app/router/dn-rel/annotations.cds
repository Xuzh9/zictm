using ReportService as service from '../../../srv/ReportService';
annotate service.PIDeliveryRel with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: DeliveryDocument },
            Description: { $Type: 'UI.DataField', Value: DeliveryDocumentItem },
            TypeName: 'PI交货单关系表',
            TypeNamePlural: 'PI交货单关系列表'
        },
        SelectionFields: [PIOrder,DeliveryDocument,DeliveryNo1,InboundDeliveryNo1,DeliveryNo2,InboundDeliveryNo2],
        LineItem: [
            { $Type: 'UI.DataField', Label: 'PI单号', Value: PIOrder },
            { $Type: 'UI.DataField', Label: 'PI单行号', Value: PIOrderItem },
            { $Type: 'UI.DataField', Label: '交货单号', Value: DeliveryDocument },
            { $Type: 'UI.DataField', Label: '交货单行号', Value: DeliveryDocumentItem},
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid },
            { $Type: 'UI.DataField', Label: '销售订单类型', Value: SalesOrderType },
            { $Type: 'UI.DataField', Label: '外向交货单号1', Value: DeliveryNo1 },
            { $Type: 'UI.DataField', Label: '外向交货单行号1', Value: DeliveryNoItem1 },
            { $Type: 'UI.DataField', Label: '内向交货单号1', Value: InboundDeliveryNo1 },
            { $Type: 'UI.DataField', Label: '内向交货单行号1', Value: InboundDeliveryNoItem1 },
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: 'PI单号', Value: PIOrder },
            { $Type: 'UI.DataField', Label: 'PI单行号', Value: PIOrderItem },
            { $Type: 'UI.DataField', Label: '交货单号', Value: DeliveryDocument },
            { $Type: 'UI.DataField', Label: '交货单行号', Value: DeliveryDocumentItem},
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid },
            { $Type: 'UI.DataField', Label: '上层行项目号', Value: ParentItem },
            { $Type: 'UI.DataField', Label: '销售订单类型', Value: SalesOrderType },
            { $Type: 'UI.DataField', Label: '外向交货单号1', Value: DeliveryNo1 },
            { $Type: 'UI.DataField', Label: '外向交货单行号1', Value: DeliveryNoItem1 },
            { $Type: 'UI.DataField', Label: '内向交货单号1', Value: InboundDeliveryNo1 },
            { $Type: 'UI.DataField', Label: '内向交货单行号1', Value: InboundDeliveryNoItem1 },
            { $Type: 'UI.DataField', Label: '外向交货单号2', Value: DeliveryNo2 },
            { $Type: 'UI.DataField', Label: '外向交货单行号2', Value: DeliveryNo2Item2 },
            { $Type: 'UI.DataField', Label: '内向交货单号2', Value: InboundDeliveryNo2 },
            { $Type: 'UI.DataField', Label: '内向交货单行号2', Value: InboundDeliveryNoItem2 }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' }
        ]
    }
);
