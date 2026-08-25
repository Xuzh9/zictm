const cds = require('@sap/cds');
const { UPDATE } = cds.ql;

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
                    code: errorMessage ? 'E' : '',
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

    /**
     * 更新接口入参日志状态
     * @param {string} id - 日志ID
     * @param {string} code - 状态码 (S成功/E失败/P处理中)
     * @param {string} message - 消息文本
     */
    static async updateApiInputLog(id, code, message) {
        if (!id) {
            console.warn('[ApiInputLogHelper] updateApiInputLog: id 为空，跳过更新');
            return;
        }
        try {
            await cds.run(
                UPDATE(cds.entities['com.sap.zictm.ApiInputLog'])
                    .set({ 
                        code: code, 
                        message: message ? message.substring(0, 500) : '',
                        executionAt: new Date() 
                    })
                    .where({ id: id })
            );
            console.log(`ApiInputLog 状态更新成功: id=${id}, code=${code}`);
        } catch (error) {
            console.error(`ApiInputLog 状态更新失败: ${error.message}`);
        }
    }
}

module.exports = ApiInputLogHelper;
