sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"sochange/test/integration/pages/SalesOrderChangeList",
	"sochange/test/integration/pages/SalesOrderChangeObjectPage"
], function (JourneyRunner, SalesOrderChangeList, SalesOrderChangeObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('sochange') + '/test/flp.html#app-preview',
        pages: {
			onTheSalesOrderChangeList: SalesOrderChangeList,
			onTheSalesOrderChangeObjectPage: SalesOrderChangeObjectPage
        },
        async: true
    });

    return runner;
});

