using MultistepLogService as service from '../../../srv/MultistepLogService';
using { Core, Common } from '@sap/cds/common';

annotate service.MultistepHeadLog with @(
    Common.Label: '多步日志查询',

    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: zrfc_logid },
            Description: { $Type: 'UI.DataField', Value: zrfcid },
            TypeName: '多步日志',
            TypeNamePlural: '多步日志列表'
        },
        SelectionFields: [zrfc_logid, zrfcid, code],

        LineItem: [
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid, Editable: false },
            { $Type: 'UI.DataField', Label: '关联ID', Value: id, Editable: false },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid, Editable: false },
            { $Type: 'UI.DataField', Label: '多方交易类型ID', Value: zdfjy, Editable: false },
            { $Type: 'UI.DataField', Label: '执行状态', Value: code, Editable: false },
            { $Type: 'UI.DataField', Label: '消息', Value: message, Editable: false },
            { $Type: 'UI.DataField', Label: '最新执行时间', Value: lastExecutionAt, Editable: false },
            {
                $Type: 'UI.DataFieldForAction',
                Label: '重推',
                Action: 'service.retryStep',
                RequiresSelection: true,
                Determining: false,
                @Common: { SideEffects: { TargetProperties: ['/service.MultistepHeadLog'] } },
                TargetProperties: ['code', 'message', 'lastExecutionAt', 'lastExecutionTime']
            }
        ],

        Identification: [
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid, Editable: false },
            { $Type: 'UI.DataField', Label: '关联ID', Value: id, Editable: false },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid, Editable: false },
            { $Type: 'UI.DataField', Label: '多方交易类型ID', Value: zdfjy, Editable: false },
            { $Type: 'UI.DataField', Label: '执行状态', Value: code, Editable: false },
            { $Type: 'UI.DataField', Label: '消息', Value: message, Editable: false },
            { $Type: 'UI.DataField', Label: '执行时间', Value: executionAt, Editable: false },
            { $Type: 'UI.DataField', Label: '最新执行时间', Value: lastExecutionAt, Editable: false },
        ],

        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '日志抬头信息', Target: '@UI.Identification' },
            { $Type: 'UI.ReferenceFacet', Label: '步骤执行日志', Target: 'items/@UI.LineItem' }
        ]
    }
);

annotate service.MultistepLog with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: canum },
            Description: { $Type: 'UI.DataField', Value: zrfc_logid },
            TypeName: '多步步骤详细日志',
            TypeNamePlural: '多步步骤详细日志列表'
        },
        LineItem: [
            { $Type: 'UI.DataField', Label: '步骤编号', Value: canum, Editable: false },
            { $Type: 'UI.DataField', Label: '描述', Value: description, Editable: false },
            { $Type: 'UI.DataField', Label: '最新执行时间', Value: lastExecutionAt, Editable: false },
            { $Type: 'UI.DataField', Label: '最新运行时间(秒)', Value: lastExecutionTime, Editable: false },
            { $Type: 'UI.DataField', Label: '消息状态', Value: code, Editable: false },
            { $Type: 'UI.DataField', Label: '消息文本', Value: message, Editable: false },
            { $Type: 'UI.DataField', Label: '对象号', Value: objkey, Editable: false }
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: '步骤编号', Value: canum, Editable: false },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid, Editable: false },
            { $Type: 'UI.DataField', Label: '描述', Value: description, Editable: false },
            { $Type: 'UI.DataField', Label: '消息状态', Value: code, Editable: false },
            { $Type: 'UI.DataField', Label: '消息文本', Value: message, Editable: false },
            { $Type: 'UI.DataField', Label: '对象类型', Value: objtype, Editable: false },
            { $Type: 'UI.DataField', Label: '对象号', Value: objkey, Editable: false },
            { $Type: 'UI.DataField', Label: '执行时间', Value: executionAt, Editable: false },
            { $Type: 'UI.DataField', Label: '运行时间(秒)', Value: executionTime, Editable: false },
            { $Type: 'UI.DataField', Label: '最新执行时间', Value: lastExecutionAt, Editable: false },
            { $Type: 'UI.DataField', Label: '最新运行时间(秒)', Value: lastExecutionTime, Editable: false }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '步骤执行信息', Target: '@UI.Identification' }
        ]

    }
);