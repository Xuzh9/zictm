using ApiInputLogService as service from '../../../srv/ApiInputLogService';
annotate service.ApiInputLog with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: id },
            TypeName: '接口日志',
            TypeNamePlural: '接口日志列表'
        },
        SelectionFields: [id,code],
        LineItem: [
            { $Type: 'UI.DataField', Label: 'ID', Value: id },
            { $Type: 'UI.DataField', Label: '消息状态', Value: code },
            { $Type: 'UI.DataField', Label: '消息文本', Value: message },
            { $Type: 'UI.DataField', Label: '执行时间', Value: executionAt}
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: 'ID', Value: id },
            { $Type: 'UI.DataField', Label: '入参数据', Value: inputData },
            { $Type: 'UI.DataField', Label: '消息状态', Value: code },
            { $Type: 'UI.DataField', Label: '消息文本', Value: message },
            { $Type: 'UI.DataField', Label: '执行时间', Value: executionAt}
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' }
        ]
    }
);