sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"sdrel/test/integration/pages/SDDocRelList.gen",
	"sdrel/test/integration/pages/SDDocRelObjectPage.gen"
], function (JourneyRunner, SDDocRelListGenerated, SDDocRelObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('sdrel') + '/test/flp.html#app-preview',
        pages: {
			onTheSDDocRelListGenerated: SDDocRelListGenerated,
			onTheSDDocRelObjectPageGenerated: SDDocRelObjectPageGenerated
        },
        async: true
    });

    return runner;
});

