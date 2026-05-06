sap.ui.define([
    "sap/fe/core/ControllerExtension",
    "sap/m/MessageToast"
], function(ControllerExtension, MessageToast) {
    "use strict";
    
    return ControllerExtension.extend("multilog.ext.controller.ListReportExtension", {
        onInit: function() {
            console.log('=== 控制器扩展初始化 ===');
        },
        
        // 处理非绑定的 action: retryStepUnbound
        onRetryStepUnbound: function(oEvent) {
            console.log('=== 控制器扩展 - onRetryStepUnbound 被调用 ===');
            
            // 获取选中的行数据
            var oBindingContext = oEvent.getSource().getBindingContext();
            if (!oBindingContext) {
                console.error('无法获取绑定上下文');
                MessageToast.show("无法获取选中的数据");
                return;
            }
            
            var oData = oBindingContext.getObject();
            console.log('选中的数据:', oData);
            
            var zrfc_logid = oData.zrfc_logid;
            var zrfcid = oData.zrfcid;
            
            if (!zrfc_logid || !zrfcid) {
                MessageToast.show("无法获取日志ID或业务流程ID");
                return;
            }
            
            console.log(`调用重推服务: zrfc_logid=${zrfc_logid}, zrfcid=${zrfcid}`);
            
            // 获取 ODataModel
            var oModel = this.getView().getModel();
            
            // 使用非绑定的 action
            oModel.callFunction("/retryStepUnbound", {
                method: "POST",
                parameters: {
                    zrfc_logid: zrfc_logid,
                    zrfcid: zrfcid
                },
                success: function(oResult) {
                    console.log('重推结果:', oResult);
                    if (oResult.code === 'E') {
                        MessageToast.show(oResult.message || "重推失败");
                    } else {
                        MessageToast.show(oResult.message || "重推成功");
                        // 刷新列表
                        window.location.reload();
                    }
                },
                error: function(oError) {
                    console.error('重推失败:', oError);
                    MessageToast.show("重推失败: " + (oError.message || oError.responseText));
                }
            });
        }
    });
});