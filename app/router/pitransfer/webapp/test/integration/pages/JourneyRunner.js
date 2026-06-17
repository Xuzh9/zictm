sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"pitransfer/test/integration/pages/PITransferList",
	"pitransfer/test/integration/pages/PITransferObjectPage"
], function (JourneyRunner, PITransferList, PITransferObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('pitransfer') + '/test/flp.html#app-preview',
        pages: {
			onThePITransferList: PITransferList,
			onThePITransferObjectPage: PITransferObjectPage
        },
        async: true
    });

    return runner;
});

