sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"sorel/test/integration/pages/PISalesOrderRelList",
	"sorel/test/integration/pages/PISalesOrderRelObjectPage"
], function (JourneyRunner, PISalesOrderRelList, PISalesOrderRelObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('sorel') + '/test/flp.html#app-preview',
        pages: {
			onThePISalesOrderRelList: PISalesOrderRelList,
			onThePISalesOrderRelObjectPage: PISalesOrderRelObjectPage
        },
        async: true
    });

    return runner;
});

