using ReportService as service from '../../../srv/ReportService';
annotate service.PaymentReceipt with @(
    UI: {
        HeaderInfo: {
            Title: { $Type: 'UI.DataField', Value: paymentReceiptNo },
            Description: { $Type: 'UI.DataField', Value: paymentReceiptNoItem },
            TypeName: '收付款单',
            TypeNamePlural: '收付款单列表'
        },
        SelectionFields: [paymentReceiptNo,businessDate,documentType,receivingUnit,incomeExpenseType,zrfcid,zrfc_logid],
        LineItem: [
            { $Type: 'UI.DataField', Label: '单据编号', Value: paymentReceiptNo },
            { $Type: 'UI.DataField', Label: '单据行号', Value: paymentReceiptNoItem },
            { $Type: 'UI.DataField', Label: '结算组织', Value: settlementOrganization },
            { $Type: 'UI.DataField', Label: '销售组织', Value: salesOrganization },
            { $Type: 'UI.DataField', Label: '采购组织', Value: procurementOrganization },
            { $Type: 'UI.DataField', Label: '收付款组织', Value: receivingOrganization },
            { $Type: 'UI.DataField', Label: '成本中心', Value: expenseResponsibleDepartment },
            { $Type: 'UI.DataField', Label: '币别', Value: currency },
            { $Type: 'UI.DataField', Label: '业务日期', Value: businessDate },
            { $Type: 'UI.DataField', Label: '单据类型', Value: documentType },
            { $Type: 'UI.DataField', Label: '业务类型', Value: businessType },
            { $Type: 'UI.DataField', Label: '抬头备注', Value: remark },
            { $Type: 'UI.DataField', Label: '结算方式', Value: settlementMethod },
            { $Type: 'UI.DataField', Label: '收付款用途', Value: paymentPurpose },
            { $Type: 'UI.DataField', Label: '收付款单位类型', Value: receivingUnitType },
            { $Type: 'UI.DataField', Label: '收付款单位', Value: receivingUnit },
            { $Type: 'UI.DataField', Label: '应收金额', Value: receivableAmount },
            { $Type: 'UI.DataField', Label: '税率', Value: taxRate },
            { $Type: 'UI.DataField', Label: '我方银行账号', Value: ourBankAccount },
            { $Type: 'UI.DataField', Label: '总账科目（资金科目）', Value: generalLedgerAccountCash },
            { $Type: 'UI.DataField', Label: '总账科目（非资金科目）', Value: generalLedgerAccountNonCash },
            { $Type: 'UI.DataField', Label: '费用项目', Value: expenseItem },
            { $Type: 'UI.DataField', Label: '明细备注', Value: itemRemark },
            { $Type: 'UI.DataField', Label: '单据名称', Value: documentName },
            { $Type: 'UI.DataField', Label: '收支类型', Value: incomeExpenseType },
            { $Type: 'UI.DataField', Label: '金融交易类型', Value: financialTransactionType },
            { $Type: 'UI.DataField', Label: '会计凭证号', Value: AccountingDocument },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid }
        ],
        Identification: [
            { $Type: 'UI.DataField', Label: '单据编号', Value: paymentReceiptNo },
            { $Type: 'UI.DataField', Label: '单据行号', Value: paymentReceiptNoItem },
            { $Type: 'UI.DataField', Label: '结算组织', Value: settlementOrganization },
            { $Type: 'UI.DataField', Label: '销售组织', Value: salesOrganization },
            { $Type: 'UI.DataField', Label: '采购组织', Value: procurementOrganization },
            { $Type: 'UI.DataField', Label: '收付款组织', Value: receivingOrganization },
            { $Type: 'UI.DataField', Label: '成本中心', Value: expenseResponsibleDepartment },
            { $Type: 'UI.DataField', Label: '币别', Value: currency },
            { $Type: 'UI.DataField', Label: '业务日期', Value: businessDate },
            { $Type: 'UI.DataField', Label: '单据类型', Value: documentType },
            { $Type: 'UI.DataField', Label: '业务类型', Value: businessType },
            { $Type: 'UI.DataField', Label: '抬头备注', Value: remark },
            { $Type: 'UI.DataField', Label: '结算方式', Value: settlementMethod },
            { $Type: 'UI.DataField', Label: '收付款用途', Value: paymentPurpose },
            { $Type: 'UI.DataField', Label: '收付款单位类型', Value: receivingUnitType },
            { $Type: 'UI.DataField', Label: '收付款单位', Value: receivingUnit },
            { $Type: 'UI.DataField', Label: '应收金额', Value: receivableAmount },
            { $Type: 'UI.DataField', Label: '税率', Value: taxRate },
            { $Type: 'UI.DataField', Label: '我方银行账号', Value: ourBankAccount },
            { $Type: 'UI.DataField', Label: '总账科目（资金科目）', Value: generalLedgerAccountCash },
            { $Type: 'UI.DataField', Label: '总账科目（非资金科目）', Value: generalLedgerAccountNonCash },
            { $Type: 'UI.DataField', Label: '费用项目', Value: expenseItem },
            { $Type: 'UI.DataField', Label: '明细备注', Value: itemRemark },
            { $Type: 'UI.DataField', Label: '单据名称', Value: documentName },
            { $Type: 'UI.DataField', Label: '收支类型', Value: incomeExpenseType },
            { $Type: 'UI.DataField', Label: '金融交易类型', Value: financialTransactionType },
            { $Type: 'UI.DataField', Label: '会计凭证号', Value: AccountingDocument },
            { $Type: 'UI.DataField', Label: '业务流程ID', Value: zrfcid },
            { $Type: 'UI.DataField', Label: '多步ID', Value: zrfc_logid }
        ],
        // 详情页面板
        Facets: [
            { $Type: 'UI.ReferenceFacet', Label: '基本信息', Target: '@UI.Identification' }
        ]
    }
);