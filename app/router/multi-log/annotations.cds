using MultistepLogService as service from '../../../srv/MultistepLogService';

// 全局字段中文标签（所有地方生效：表格、筛选、详情）
annotate service.MultistepLog with {
    zrfc_logid     @Common.Label: '日志ID';
    zrfcid         @Common.Label: '业务流程ID';
    canum          @Common.Label: '步骤编号';
    code           @Common.Label: '执行状态';
    message        @Common.Label: '消息';
    objkey         @Common.Label: '对象号';
    executionAt    @Common.Label: '执行时间';
    executionTime  @Common.Label: '运行时间（秒）';
};

annotate service.MultistepLog with @(
    Common.Label: '多步日志查询',

    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: zrfcid },
            Description: { $Type: 'UI.DataField', Value: message },
            TypeName: '多步日志查询',
            TypeNamePlural: '多步日志查询'
        },
        SelectionFields: [zrfc_logid, zrfcid, code],

        // ==============================================
        // 这里全部删掉 Label，自动使用全局 @Common.Label
        // ==============================================
        LineItem: [
            { $Type: 'UI.DataField', Value: zrfc_logid },
            { $Type: 'UI.DataField', Value: zrfcid },
            { $Type: 'UI.DataField', Value: canum },
            { $Type: 'UI.DataField', Value: code },
            { $Type: 'UI.DataField', Value: executionAt },
            { $Type: 'UI.DataField', Value: executionTime },
            { $Type: 'UI.DataField', Value: message },
            { $Type: 'UI.DataField', Value: objkey },
            {
                $Type: 'UI.DataFieldForAction',
                Label: '重推',
                Action: 'service.MultistepLog.retryStep',
                RequiresSelection: true
            }
        ],

        Identification: [
            { $Type: 'UI.DataField', Value: zrfc_logid },
            { $Type: 'UI.DataField', Value: zrfcid },
            { $Type: 'UI.DataField', Value: canum },
            { $Type: 'UI.DataField', Value: code },
            { $Type: 'UI.DataField', Value: executionAt },
            { $Type: 'UI.DataField', Value: executionTime },
            { $Type: 'UI.DataField', Value: message },
            { $Type: 'UI.DataField', Value: objkey }
        ],

        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '日志信息', Target: '@UI.Identification' }
        ]
    }
);