sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"paymentreceipt/test/integration/pages/PaymentReceiptList",
	"paymentreceipt/test/integration/pages/PaymentReceiptObjectPage"
], function (JourneyRunner, PaymentReceiptList, PaymentReceiptObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('paymentreceipt') + '/test/flp.html#app-preview',
        pages: {
			onThePaymentReceiptList: PaymentReceiptList,
			onThePaymentReceiptObjectPage: PaymentReceiptObjectPage
        },
        async: true
    });

    return runner;
});

