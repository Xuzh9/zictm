sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"mpt/test/integration/pages/MPTTypeConfigList",
	"mpt/test/integration/pages/MPTTypeConfigObjectPage",
	"mpt/test/integration/pages/MPTStepConfigObjectPage"
], function (JourneyRunner, MPTTypeConfigList, MPTTypeConfigObjectPage, MPTStepConfigObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('mpt') + '/test/flp.html#app-preview',
        pages: {
			onTheMPTTypeConfigList: MPTTypeConfigList,
			onTheMPTTypeConfigObjectPage: MPTTypeConfigObjectPage,
			onTheMPTStepConfigObjectPage: MPTStepConfigObjectPage
        },
        async: true
    });

    return runner;
});

