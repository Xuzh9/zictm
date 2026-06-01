sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"dnrel/test/integration/pages/PIDeliveryRelList",
	"dnrel/test/integration/pages/PIDeliveryRelObjectPage"
], function (JourneyRunner, PIDeliveryRelList, PIDeliveryRelObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('dnrel') + '/test/flp.html#app-preview',
        pages: {
			onThePIDeliveryRelList: PIDeliveryRelList,
			onThePIDeliveryRelObjectPage: PIDeliveryRelObjectPage
        },
        async: true
    });

    return runner;
});

