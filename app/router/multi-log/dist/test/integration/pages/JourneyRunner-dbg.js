sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"multilog/test/integration/pages/MultistepLogList",
	"multilog/test/integration/pages/MultistepLogObjectPage"
], function (JourneyRunner, MultistepLogList, MultistepLogObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('multilog') + '/test/flp.html#app-preview',
        pages: {
			onTheMultistepLogList: MultistepLogList,
			onTheMultistepLogObjectPage: MultistepLogObjectPage
        },
        async: true
    });

    return runner;
});

