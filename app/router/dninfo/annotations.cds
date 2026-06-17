using ReportService as service from '../../../srv/ReportService';
annotate service.DeliveryActualInfo with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: DeliveryDocument },
            Description: { $Type: 'UI.DataField', Value: DeliveryDocumentItem },
            TypeName: '交货单表',
            TypeNamePlural: '交货单列表'
        },
        SelectionFields: [DeliveryDocument, Material, ActualGoodsMovementDate,code,zrfc_logid],
        LineItem: [
            { $Type: 'UI.DataField', Label: '交货单号', Value: DeliveryDocument },
            { $Type: 'UI.DataField', Label: '交货单行号', Value: DeliveryDocumentItem },
            { $Type: 'UI.DataField', Label: '实际发货日期', Value: ActualGoodsMovementDate },
            { $Type: 'UI.DataField', Label: '发货状态', Value: YY1_FD_SPZT },
            { $Type: 'UI.DataField', Label: '物料号', Value: Material },
            { $Type: 'UI.DataField', Label: '库存地点', Value: StorageLocation },
            { $Type: 'UI.DataField', Label: '实际交货数量', Value: ActualDeliveryQuantity },
            { $Type: 'UI.DataField', Label: '批次', Value: Batch },
            { $Type: 'UI.DataField', Label: '上级行项目', Value: ParentItem },
            { $Type: 'UI.DataField', Label: '参考凭证号', Value: RefDocNo },
            { $Type: 'UI.DataField', Label: '参考凭证行号', Value: RefDocItem },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid },
            { $Type: 'UI.DataField', Label: '消息状态', Value: code },
            { $Type: 'UI.DataField', Label: '消息文本', Value: message },
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: '交货单号', Value: DeliveryDocument },
            { $Type: 'UI.DataField', Label: '交货单行号', Value: DeliveryDocumentItem },
            { $Type: 'UI.DataField', Label: '实际发货日期', Value: ActualGoodsMovementDate },
            { $Type: 'UI.DataField', Label: '发货状态', Value: YY1_FD_SPZT },
            { $Type: 'UI.DataField', Label: '物料号', Value: Material },
            { $Type: 'UI.DataField', Label: '库存地点', Value: StorageLocation },
            { $Type: 'UI.DataField', Label: '实际交货数量', Value: ActualDeliveryQuantity },
            { $Type: 'UI.DataField', Label: '批次', Value: Batch },
            { $Type: 'UI.DataField', Label: '上级行项目', Value: ParentItem },
            { $Type: 'UI.DataField', Label: '参考凭证号', Value: RefDocNo },
            { $Type: 'UI.DataField', Label: '参考凭证行号', Value: RefDocItem },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid },
            { $Type: 'UI.DataField', Label: '消息状态', Value: code },
            { $Type: 'UI.DataField', Label: '消息文本', Value: message },
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' }
        ]
    }
);