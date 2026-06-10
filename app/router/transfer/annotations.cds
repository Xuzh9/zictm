using ReportService as service from '../../../srv/ReportService';
annotate service.Transfer with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: TransferOrder },
            Description: { $Type: 'UI.DataField', Value: TransferOrderItem },
            TypeName: '调拨单',
            TypeNamePlural: '调拨单列表'
        },
        SelectionFields: [TransferOrder,Material,Plant,Customer,zrfcid,zrfc_logid],
        // 列表展示字段（表格列）
        LineItem: [
            { $Type: 'UI.DataField', Label: '调拨单', Value: TransferOrder },
            { $Type: 'UI.DataField', Label: '调拨单行项目', Value: TransferOrderItem },
            { $Type: 'UI.DataField', Label: '过账日期', Value: PostingDate },
            { $Type: 'UI.DataField', Label: '移动类型代码', Value: GoodsMovementCode },
            { $Type: 'UI.DataField', Label: '客户', Value: Customer },
            { $Type: 'UI.DataField', Label: '物料编号', Value: Material },
            { $Type: 'UI.DataField', Label: '发出工厂', Value: Plant },
            { $Type: 'UI.DataField', Label: '库存地点', Value: StorageLocation },
            { $Type: 'UI.DataField', Label: '移动类型', Value: GoodsMovementType },
            { $Type: 'UI.DataField', Label: '数量', Value: QuantityInBaseUnit },
            { $Type: 'UI.DataField', Label: '收货/发货库存地点', Value: IssuingOrReceivingStorageLoc },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid }
        ],
        // 详情页标识字段
        Identification: [
            { $Type: 'UI.DataField', Label: '调拨单', Value: TransferOrder },
            { $Type: 'UI.DataField', Label: '调拨单行项目', Value: TransferOrderItem },
            { $Type: 'UI.DataField', Label: '过账日期', Value: PostingDate },
            { $Type: 'UI.DataField', Label: '移动类型代码', Value: GoodsMovementCode },
            { $Type: 'UI.DataField', Label: '客户', Value: Customer },
            { $Type: 'UI.DataField', Label: '物料编号', Value: Material },
            { $Type: 'UI.DataField', Label: '发出工厂', Value: Plant },
            { $Type: 'UI.DataField', Label: '库存地点', Value: StorageLocation },
            { $Type: 'UI.DataField', Label: '移动类型', Value: GoodsMovementType },
            { $Type: 'UI.DataField', Label: '数量', Value: QuantityInBaseUnit },
            { $Type: 'UI.DataField', Label: '收货/发货库存地点', Value: IssuingOrReceivingStorageLoc },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid }
        ],
        // 详情页面板
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' }
        ]
    }
);