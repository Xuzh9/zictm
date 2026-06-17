sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"socreate/test/integration/pages/SalesOrderCreateList",
	"socreate/test/integration/pages/SalesOrderCreateObjectPage"
], function (JourneyRunner, SalesOrderCreateList, SalesOrderCreateObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('socreate') + '/test/flp.html#app-preview',
        pages: {
			onTheSalesOrderCreateList: SalesOrderCreateList,
			onTheSalesOrderCreateObjectPage: SalesOrderCreateObjectPage
        },
        async: true
    });

    return runner;
});

