sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"apilog/test/integration/pages/ApiInputLogList",
	"apilog/test/integration/pages/ApiInputLogObjectPage"
], function (JourneyRunner, ApiInputLogList, ApiInputLogObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('apilog') + '/test/flp.html#app-preview',
        pages: {
			onTheApiInputLogList: ApiInputLogList,
			onTheApiInputLogObjectPage: ApiInputLogObjectPage
        },
        async: true
    });

    return runner;
});

