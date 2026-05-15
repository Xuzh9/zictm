const cds = require('@sap/cds');

class ApiInputLogHelper {
    /**
     * 保存接口入参日志
     * @param {Object} inputData - 输入数据（不需要包含 zrfcLogid）
     * @param {string} errorMessage - 错误消息（可选）
     * @returns {string} 生成的日志ID
     */
    static async saveApiInputLog(inputData, errorMessage = null) {
        const ApiInputLog = cds.entities['com.sap.zictm.ApiInputLog'];
        
        // 生成 UUID 作为日志 ID
        const logId = cds.utils.uuid();
        
        let inputDataStr = JSON.stringify(inputData);
        if (inputDataStr.length > 1000) {
            inputDataStr = inputDataStr.substring(0, 1000) + '...';
        }
        
        await cds.run(
            INSERT.into(ApiInputLog).entries({
                id: logId,
                inputData: inputDataStr,
                code: errorMessage ? 'E' : 'S',
                message: errorMessage || '入参处理成功',
                executionAt: new Date()
            })
        );
        
        return logId;
    }
}

module.exports = ApiInputLogHelper;