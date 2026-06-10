sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"transfer/test/integration/pages/TransferList",
	"transfer/test/integration/pages/TransferObjectPage"
], function (JourneyRunner, TransferList, TransferObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('transfer') + '/test/flp.html#app-preview',
        pages: {
			onTheTransferList: TransferList,
			onTheTransferObjectPage: TransferObjectPage
        },
        async: true
    });

    return runner;
});

