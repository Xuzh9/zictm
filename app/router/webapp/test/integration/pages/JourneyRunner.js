sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"multistep/test/integration/pages/ProcessConfigList",
	"multistep/test/integration/pages/ProcessConfigObjectPage",
	"multistep/test/integration/pages/StepConfigObjectPage"
], function (JourneyRunner, ProcessConfigList, ProcessConfigObjectPage, StepConfigObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('multistep') + '/test/flp.html#app-preview',
        pages: {
			onTheProcessConfigList: ProcessConfigList,
			onTheProcessConfigObjectPage: ProcessConfigObjectPage,
			onTheStepConfigObjectPage: StepConfigObjectPage
        },
        async: true
    });

    return runner;
});

