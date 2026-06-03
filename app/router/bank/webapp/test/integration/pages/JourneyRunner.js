sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"bank/test/integration/pages/BankInfoList",
	"bank/test/integration/pages/BankInfoObjectPage"
], function (JourneyRunner, BankInfoList, BankInfoObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('bank') + '/test/flp.html#app-preview',
        pages: {
			onTheBankInfoList: BankInfoList,
			onTheBankInfoObjectPage: BankInfoObjectPage
        },
        async: true
    });

    return runner;
});

