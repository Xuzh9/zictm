    const cds = require('@sap/cds');
    const { SELECT } = cds.ql;
    const RetryHandler = require('./handlers/RetryHandler');

    const retryHandler = new RetryHandler();

    module.exports = srv => {
        const { MultistepLog } = srv.entities;

        // 自定义 READ 处理，按日志ID + 步骤编号排序
        srv.on('READ', MultistepLog, async (req) => {
            // 移除分页，先获取全部数据
            const { limit, offset } = req.query.SELECT;
            delete req.query.SELECT.limit;
            delete req.query.SELECT.offset;

            let results = await cds.run(req.query);

            // 先按日志ID排序，再按步骤编号排序
            results.sort((a, b) => {
                if (a.zrfc_logid !== b.zrfc_logid) {
                    return a.zrfc_logid < b.zrfc_logid ? -1 : 1;
                }
                return a.canum - b.canum;
            });

            // 手动处理分页
            if (limit && offset) {
                const skip = offset.val || 0;
                const top = limit.rows?.val || limit.val || 1000;
                results = results.slice(skip, skip + top);
            }

            return results;
        });

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