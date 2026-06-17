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
        const id = cds.utils.uuid();
        
        let inputDataStr = JSON.stringify(inputData);

        try {
            await cds.run(
                INSERT.into(ApiInputLog).entries({
                    id: id,
                    inputData: inputDataStr,
                    code: errorMessage ? 'E' : 'S',
                    message: errorMessage || '入参处理成功',
                    executionAt: new Date()
                })
            );
            console.log(`ApiInputLog 保存成功: id=${id}`);
        } catch (error) {
            console.error(`ApiInputLog 保存失败: ${error.message}`);
            // 即使保存失败，也要返回生成的 id，方便追踪
        }
        
        return id;
    }
}

module.exports = ApiInputLogHelper;