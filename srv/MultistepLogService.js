const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const RetryHandler = require('./handlers/RetryHandler');

module.exports = srv => {
    const { MultistepLog } = srv.entities;

    // Bound Action - 支持单选和多选
    srv.on('retryStep', 'MultistepLog', async (req) => {
        // 获取所有选中行的主键数组
        let selectedIds = req.params;
        // 处理参数格式
        if (!selectedIds || selectedIds.length === 0) {
            return req.error(500, '请至少选择一行数据');
        }

        // 确保 selectedIds 是字符串数组
        const stringIds = [];
        for (const param of selectedIds) {
            if (typeof param === 'string') {
                stringIds.push(param);
            } else if (param?.zrfc_logid) {
                stringIds.push(param.zrfc_logid);
            } else if (param?.ZRFC_LOGID) {
                stringIds.push(param.ZRFC_LOGID);
            }
        }
        
        selectedIds = stringIds;

        if (selectedIds.length === 0) {
            return req.error(500, '请至少选择一行数据');
        }

        // 批量校验所有数据
        const invalidLogids = [];
        for (const zrfc_logid of selectedIds) {
            const allLogs = await SELECT.from(MultistepLog).where({ zrfc_logid });
            const failedSteps = allLogs.filter(log => log.code !== 'S' && log.code !== 's');
            
            if (failedSteps.length === 0) {
                invalidLogids.push(zrfc_logid);
            }
        }

        if (invalidLogids.length > 0) {
            const errorMsg = invalidLogids.map(id => `业务ID ${id} 没有失败的步骤，无法重推`).join('\n');
            return req.error(500, errorMsg);
        }

        // 批量遍历处理所有选中的数据
        for (const zrfc_logid of selectedIds) {

            // 调用重试处理器 - 日志更新由 MultiStepProcessor 统一处理
            const retryHandler = new RetryHandler();
            await retryHandler.retry(zrfc_logid);
        }

        // 返回所有数据（触发 Fiori Elements 重新渲染整个列表）
        const allData = await SELECT.from(MultistepLog);
        
        // 使用轻量级通知（note）替代弹窗
        req.notify({
            code: '200',
            message: `已重推 ${selectedIds.length} 条记录`,
            severity: 'success'
        });

        return allData;
    });
};
