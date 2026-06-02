using ConfigService as service from '../../../srv/ConfigService';
annotate service.MPTTypeConfig with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: zdfjy },
            Description: { $Type: 'UI.DataField', Value: description },
            TypeName: '多方交易类型配置',
            TypeNamePlural: '多方交易类型配置列表'
        },
        SelectionFields: [zdfjy, zrfcid, zxsf, zfcf],
        LineItem: [
            { $Type: 'UI.DataField', Label: '交易类型ID', Value: zdfjy },
            { $Type: 'UI.DataField', Label: '类型描述', Value: description },
            { $Type: 'UI.DataField', Label: '关联流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '销售方', Value: zxsf },
            { $Type: 'UI.DataField', Label: '发出方', Value: zfcf },
            { $Type: 'UI.DataField', Label: '系统', Value: system }
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: '交易类型ID', Value: zdfjy, Editable: true },
            { $Type: 'UI.DataField', Label: '类型描述', Value: description, Editable: true },
            { $Type: 'UI.DataField', Label: '关联流程ID', Value: zrfcid, Editable: true },
            { $Type: 'UI.DataField', Label: '销售方', Value: zxsf, Editable: true },
            { $Type: 'UI.DataField', Label: '发出方', Value: zfcf, Editable: true },
            { $Type: 'UI.DataField', Label: '系统', Value: system }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' },
            { $Type: 'UI.ReferenceFacet', Label: '步骤配置', Target: 'steps/@UI.LineItem' }
        ]
    }
);

// ======================================================
// MPTStepConfig 子表：多方交易步骤配置
// ======================================================
annotate service.MPTStepConfig with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: canum },
            Description: { $Type: 'UI.DataField', Value: zdfjy },
            TypeName: '多方交易步骤配置',
            TypeNamePlural: '多方交易步骤配置列表'
        },
        LineItem: [
            { $Type: 'UI.DataField', Label: '步骤编号', Value: canum, Editable: true },
            { $Type: 'UI.DataField', Label: '公司代码', Value: bukrs, Editable: true },
            { $Type: 'UI.DataField', Label: '销售组织', Value: vkorg, Editable: true },
            { $Type: 'UI.DataField', Label: '分销渠道', Value: vtweg, Editable: true },
            { $Type: 'UI.DataField', Label: '发货工厂', Value: werks, Editable: true },
            { $Type: 'UI.DataField', Label: '发货库位', Value: lgort, Editable: true },
            { $Type: 'UI.DataField', Label: '客户', Value: kunnr, Editable: true },
            { $Type: 'UI.DataField', Label: '采购组织', Value: ekorg, Editable: true },
            { $Type: 'UI.DataField', Label: '采购组', Value: ekgrp, Editable: true },
            { $Type: 'UI.DataField', Label: '收货工厂', Value: umwrk, Editable: true },
            { $Type: 'UI.DataField', Label: '收货库位', Value: umlgo, Editable: true },
            { $Type: 'UI.DataField', Label: '供应商', Value: lifnr, Editable: true },
            { $Type: 'UI.DataField', Label: '价格比例', Value: zjgbl, Editable: true },
            { $Type: 'UI.DataField', Label: '税码', Value: mwskz, Editable: true },
            { $Type: 'UI.DataField', Label: '税率', Value: zsl, Editable: true },
            { $Type: 'UI.DataField', Label: '价格方向', Value: zjgfx, Editable: true }
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: '步骤编号', Value: canum, Editable: true },
            { $Type: 'UI.DataField', Label: '公司代码', Value: bukrs, Editable: true },
            { $Type: 'UI.DataField', Label: '销售组织', Value: vkorg, Editable: true },
            { $Type: 'UI.DataField', Label: '分销渠道', Value: vtweg, Editable: true },
            { $Type: 'UI.DataField', Label: '发货工厂', Value: werks, Editable: true },
            { $Type: 'UI.DataField', Label: '发货库位', Value: lgort, Editable: true },
            { $Type: 'UI.DataField', Label: '客户', Value: kunnr, Editable: true },
            { $Type: 'UI.DataField', Label: '采购组织', Value: ekorg, Editable: true },
            { $Type: 'UI.DataField', Label: '采购组', Value: ekgrp, Editable: true },
            { $Type: 'UI.DataField', Label: '收货工厂', Value: umwrk, Editable: true },
            { $Type: 'UI.DataField', Label: '收货库位', Value: umlgo, Editable: true },
            { $Type: 'UI.DataField', Label: '供应商', Value: lifnr, Editable: true },
            { $Type: 'UI.DataField', Label: '价格比例', Value: zjgbl, Editable: true },
            { $Type: 'UI.DataField', Label: '税码', Value: mwskz, Editable: true },
            { $Type: 'UI.DataField', Label: '税率', Value: zsl, Editable: true },
            { $Type: 'UI.DataField', Label: '价格方向', Value: zjgfx, Editable: true }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '步骤基本信息', Target: '@UI.Identification' }
        ]
    }
);