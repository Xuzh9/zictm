sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"dninfo/test/integration/pages/DeliveryActualInfoList",
	"dninfo/test/integration/pages/DeliveryActualInfoObjectPage"
], function (JourneyRunner, DeliveryActualInfoList, DeliveryActualInfoObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('dninfo') + '/test/flp.html#app-preview',
        pages: {
			onTheDeliveryActualInfoList: DeliveryActualInfoList,
			onTheDeliveryActualInfoObjectPage: DeliveryActualInfoObjectPage
        },
        async: true
    });

    return runner;
});

