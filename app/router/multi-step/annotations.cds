using ConfigService as service from '../../../srv/ConfigService';
annotate service.ProcessConfig with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: zrfcid },
            Description: { $Type: 'UI.DataField', Value: description },
            TypeName: '业务流程配置',
            TypeNamePlural: '业务流程配置列表'
        },
        SelectionFields: [zrfcid],
        LineItem: [
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '流程描述', Value: description },
            { $Type: 'UI.DataField', Label: '业务表1', Value: businessTable1 },
            { $Type: 'UI.DataField', Label: '业务表2', Value: businessTable2 },
            { $Type: 'UI.DataField', Label: '业务表3', Value: businessTable3 },
            { $Type: 'UI.DataField', Label: '是否异步', Value: isAsync }
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid, Editable: true },
            { $Type: 'UI.DataField', Label: '流程描述', Value: description, Editable: true },
            { $Type: 'UI.DataField', Label: '业务表1', Value: businessTable1, Editable: true },
            { $Type: 'UI.DataField', Label: '业务表2', Value: businessTable2, Editable: true },
            { $Type: 'UI.DataField', Label: '业务表3', Value: businessTable3, Editable: true },
            { $Type: 'UI.DataField', Label: '是否异步', Value: isAsync, Editable: true }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' },
            { $Type: 'UI.ReferenceFacet', Label: '步骤配置', Target: 'steps/@UI.LineItem' }
        ]
    }
);

annotate service.StepConfig with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: canum },
            Description: { $Type: 'UI.DataField', Value: description },
            TypeName: '步骤配置详情',
            TypeNamePlural: '步骤配置列表'
        },
        LineItem: [
            { $Type: 'UI.DataField', Label: '流程ID', Value: zrfcid, Editable: true },
            { $Type: 'UI.DataField', Label: '步骤编号', Value: canum, Editable: true },
            { $Type: 'UI.DataField', Label: '步骤描述', Value: description, Editable: true },
            { $Type: 'UI.DataField', Label: '服务文件名', Value: serviceName, Editable: true },
            { $Type: 'UI.DataField', Label: '对象类型', Value: objtype, Editable: true },
            { $Type: 'UI.DataField', Label: '读取步骤', Value: readsteps, Editable: true }
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: '流程ID', Value: zrfcid, Editable: true },
            { $Type: 'UI.DataField', Label: '步骤编号', Value: canum, Editable: true },
            { $Type: 'UI.DataField', Label: '步骤描述', Value: description, Editable: true },
            { $Type: 'UI.DataField', Label: '服务文件名', Value: serviceName, Editable: true },
            { $Type: 'UI.DataField', Label: '对象类型', Value: objtype, Editable: true },
            { $Type: 'UI.DataField', Label: '读取步骤', Value: readsteps, Editable: true }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '步骤基本信息', Target: '@UI.Identification' }
        ]
    }
);