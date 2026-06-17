using ReportService as service from '../../../srv/ReportService';
annotate service.PITransfer with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: PIOrder },
            Description: { $Type: 'UI.DataField', Value: PIOrderItem },
            TypeName: '调拨单',
            TypeNamePlural: '调拨单列表'
        },
        SelectionFields: [PIOrder,Material,Plant,PostingDate,code,zrfc_logid],
        LineItem: [
            { $Type: 'UI.DataField', Label: 'PI单号', Value: PIOrder },
            { $Type: 'UI.DataField', Label: 'PI单行号', Value: PIOrderItem },
            { $Type: 'UI.DataField', Label: 'ID', Value: ID },
            { $Type: 'UI.DataField', Label: '过账日期', Value: PostingDate },
            { $Type: 'UI.DataField', Label: '移动类型代码', Value: GoodsMovementCode },
            { $Type: 'UI.DataField', Label: '物料编号', Value: Material },
            { $Type: 'UI.DataField', Label: '发出工厂', Value: Plant },
            { $Type: 'UI.DataField', Label: '库存地点', Value: StorageLocation },
            { $Type: 'UI.DataField', Label: '移动类型', Value: GoodsMovementType },
            { $Type: 'UI.DataField', Label: '数量', Value: QuantityInBaseUnit },
            { $Type: 'UI.DataField', Label: '收货/发货库存地点', Value: IssuingOrReceivingStorageLoc },
            { $Type: 'UI.DataField', Label: '卸货点', Value: UnloadingPointName },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid },
            { $Type: 'UI.DataField', Label: '消息状态', Value: code },
            { $Type: 'UI.DataField', Label: '消息文本', Value: message },
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: 'PI单号', Value: PIOrder },
            { $Type: 'UI.DataField', Label: 'PI单行号', Value: PIOrderItem },
            { $Type: 'UI.DataField', Label: 'ID', Value: ID },
            { $Type: 'UI.DataField', Label: '过账日期', Value: PostingDate },
            { $Type: 'UI.DataField', Label: '移动类型代码', Value: GoodsMovementCode },
            { $Type: 'UI.DataField', Label: '物料编号', Value: Material },
            { $Type: 'UI.DataField', Label: '发出工厂', Value: Plant },
            { $Type: 'UI.DataField', Label: '库存地点', Value: StorageLocation },
            { $Type: 'UI.DataField', Label: '移动类型', Value: GoodsMovementType },
            { $Type: 'UI.DataField', Label: '数量', Value: QuantityInBaseUnit },
            { $Type: 'UI.DataField', Label: '收货/发货库存地点', Value: IssuingOrReceivingStorageLoc },
            { $Type: 'UI.DataField', Label: '卸货点', Value: UnloadingPointName },
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