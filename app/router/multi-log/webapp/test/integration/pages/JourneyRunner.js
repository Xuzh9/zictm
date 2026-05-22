sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"multilog/test/integration/pages/MultistepHeadLogList",
	"multilog/test/integration/pages/MultistepHeadLogObjectPage",
	"multilog/test/integration/pages/MultistepLogObjectPage"
], function (JourneyRunner, MultistepHeadLogList, MultistepHeadLogObjectPage, MultistepLogObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('multilog') + '/test/flp.html#app-preview',
        pages: {
			onTheMultistepHeadLogList: MultistepHeadLogList,
			onTheMultistepHeadLogObjectPage: MultistepHeadLogObjectPage,
			onTheMultistepLogObjectPage: MultistepLogObjectPage
        },
        async: true
    });

    return runner;
});

