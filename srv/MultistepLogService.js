module.exports = cds.service.impl(async function () {
    const { MultistepLog } = this.entities;
    const RetryHandler = require('./handlers/RetryHandler');
    
    this.on('retryStep', async (req) => {
        const oData = Array.isArray(req.params) && req.params.length > 0 ? req.params[0] : req.params;
        
        const zrfc_logid = oData && (oData.zrfc_logid || oData.ZrfcLogid || oData.ZRFC_LOGID);
        
        if (!zrfc_logid) {
            return req.error(500, '无法获取日志ID，请选择一行数据');
        }
        
        return await this._handleRetryStep(zrfc_logid, null, req);
    });
    
    this.on('retryStepUnbound', async (req) => {
        const { zrfc_logid, zrfcid } = req.data;
        
        if (!zrfc_logid) {
            return req.error(500, '无法获取日志ID');
        }
        
        if (!zrfcid) {
            return req.error(500, '无法获取业务流程ID');
        }
        
        return await this._handleRetryStep(zrfc_logid, zrfcid, req);
    });
    
    this._handleRetryStep = async function(zrfc_logid, zrfcid, req) {
        try {
            const allLogs = await SELECT.from(MultistepLog).where({ zrfc_logid });
            
            const failedSteps = allLogs.filter(log => log.code !== 'S' && log.code !== 's');
            
            if (failedSteps.length === 0) {
                return req.error(500, `业务ID ${zrfc_logid} 没有失败的步骤，无法执行重推`);
            }
            
            await UPDATE(MultistepLog)
                .set({ code: 'R', message: '重推中...' })
                .where({ zrfc_logid });
            
            const retryHandler = new RetryHandler();
            const result = await retryHandler.retry(zrfc_logid);
            
            if (result.code === 'E') {
                return req.error(500, result.message);
            }
            
            return {
                code: result.code,
                message: result.message
            };
            
        } catch (error) {
            return req.error(500, `重推失败: ${error.message}`);
        }
    };
});