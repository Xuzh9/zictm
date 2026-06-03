using BankService as service from '../../../srv/BankService';
annotate service.BankInfo with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: bankAccountNo },
            Description: { $Type: 'UI.DataField', Value: bankReceiptNo },
            TypeName: '银行信息表',
            TypeNamePlural: '银行信息列表'
        },
        SelectionFields: [bankAccountNo,bankReceiptNo],
        LineItem: [
            { $Type: 'UI.DataField', Label: '银行账号', Value: bankAccountNo },
            { $Type: 'UI.DataField', Label: '银行回单编号', Value: bankReceiptNo },
            { $Type: 'UI.DataField', Label: '短URL', Value: shortUrl }
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: '银行账号', Value: bankAccountNo },
            { $Type: 'UI.DataField', Label: '银行回单编号', Value: bankReceiptNo },
            { $Type: 'UI.DataField', Label: '短URL', Value: shortUrl },
            { $Type: 'UI.DataField', Label: '长URL', Value: memoLine}
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' }
        ]
    }
);


