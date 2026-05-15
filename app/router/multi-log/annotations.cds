using MultistepLogService as service from '../../../srv/MultistepLogService';
using { Core, Common } from '@sap/cds/common';

// 全局字段中文标签
annotate service.MultistepLog with {
    zrfc_logid         @Common.Label: '日志ID';
    zrfcid             @Common.Label: '业务流程ID';
    canum              @Common.Label: '步骤编号';
    code               @Common.Label: '执行状态';
    message            @Common.Label: '消息';
    objkey             @Common.Label: '对象号';
    executionAt        @Common.Label: '执行时间';
    executionTime      @Common.Label: '运行时间（秒）';
    lastExecutionAt    @Common.Label: '最新执行时间';
    lastExecutionTime  @Common.Label: '最新运行时间（秒）';
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

        LineItem: [
            { $Type: 'UI.DataField', Value: zrfc_logid },
            { $Type: 'UI.DataField', Value: zrfcid },
            { $Type: 'UI.DataField', Value: canum },
            { $Type: 'UI.DataField', Value: description },
            { $Type: 'UI.DataField', Value: code },
            { $Type: 'UI.DataField', Value: message },
            { $Type: 'UI.DataField', Value: objkey },
            { $Type: 'UI.DataField', Value: lastExecutionAt },
            {
                $Type: 'UI.DataFieldForAction',
                Label: '重推',
                Action: 'service.retryStep',
                RequiresSelection: true,
                Determining: false,
                @Common: { SideEffects: { TargetProperties: ['/service.MultistepLog'] } },
                TargetProperties: ['code', 'message', 'objkey','lastExecutionAt', 'lastExecutionTime']
            }
        ],

        Identification: [
            { $Type: 'UI.DataField', Value: zrfc_logid },
            { $Type: 'UI.DataField', Value: zrfcid },
            { $Type: 'UI.DataField', Value: canum },
            { $Type: 'UI.DataField', Value: description },
            { $Type: 'UI.DataField', Value: code },
            { $Type: 'UI.DataField', Value: message },
            { $Type: 'UI.DataField', Value: objtype },
            { $Type: 'UI.DataField', Value: objkey },
            { $Type: 'UI.DataField', Value: executionAt },
            { $Type: 'UI.DataField', Value: executionTime },
            { $Type: 'UI.DataField', Value: lastExecutionAt },
            { $Type: 'UI.DataField', Value: lastExecutionTime }
        ],

        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '日志信息', Target: '@UI.Identification' }
        ]
    }
);