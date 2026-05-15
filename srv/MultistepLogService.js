    const cds = require('@sap/cds');
    const { SELECT } = cds.ql;
    const RetryHandler = require('./handlers/RetryHandler');

    const retryHandler = new RetryHandler();

    module.exports = srv => {
        const { MultistepLog } = srv.entities;

        srv.on('retryStep', MultistepLog, async (req) => {
            const targetKey = req.params[0];
            if (!targetKey) return req.error(400, '请选择数据');

            const zrfcLogid = targetKey.zrfc_logid;
            const canum = targetKey.canum;
            
            console.log('[MultistepLogService] 收到重推请求 - zrfcLogid:', zrfcLogid, ', canum:', canum);

            try {
                console.log('[MultistepLogService] 开始处理日志ID:', zrfcLogid);
                
                const failedSteps = await cds.run(
                    SELECT.from(MultistepLog).where({ 
                        zrfc_logid: zrfcLogid, 
                        code: { in: ['E', null, ''] } 
                    })
                );
                
                if (failedSteps.length === 0) {
                    const errMsg = `日志ID ${zrfcLogid} 没有失败的步骤，无法重推`;
                    console.error('[MultistepLogService]', errMsg);
                    return req.error(500, errMsg);
                }

                await retryHandler.retry(zrfcLogid);
                console.log('[MultistepLogService] 日志ID', zrfcLogid, '重推成功');
                return SELECT.one(MultistepLog).where(targetKey);
                
            } catch (error) {
                console.error('[MultistepLogService] 日志ID', zrfcLogid, '处理失败:', error.message);
                return req.error(500, error.message);
            }
        });
    };
