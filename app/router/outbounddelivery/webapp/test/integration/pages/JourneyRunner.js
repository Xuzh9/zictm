sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"outbounddelivery/test/integration/pages/OutboundDeliveryList",
	"outbounddelivery/test/integration/pages/OutboundDeliveryObjectPage"
], function (JourneyRunner, OutboundDeliveryList, OutboundDeliveryObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('outbounddelivery') + '/test/flp.html#app-preview',
        pages: {
			onTheOutboundDeliveryList: OutboundDeliveryList,
			onTheOutboundDeliveryObjectPage: OutboundDeliveryObjectPage
        },
        async: true
    });

    return runner;
});

