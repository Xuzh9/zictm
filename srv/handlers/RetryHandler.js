const cds = require('@sap/cds');
const MultiStepProcessor = require('./MultiStepProcessor');

class RetryHandler {
    constructor() {
        this.db = cds.transaction();
        this.processor = new MultiStepProcessor();
    }

    /**
     * 重处理失败的业务流程
     * @param {string} zrfcLogid - 多步ID
     * @returns {Promise<Object>} 执行结果
     */
    async retry(zrfcLogid) {
        try {
            // 查询多步执行日志，找到失败的步骤
            const failedSteps = await this.getFailedSteps(zrfcLogid);
            
            if (failedSteps.length === 0) {
                // 没有失败步骤，返回错误
                throw new Error('没有失败步骤，无法重推');
            }

            // 找到最早的失败步骤
            const firstFailedStep = failedSteps.sort((a, b) => parseInt(a.canum) - parseInt(b.canum))[0];
            const zrfcid = firstFailedStep.zrfcid;
            const failedStepNum = parseInt(firstFailedStep.canum);

            // 调用 MultiStepProcessor 的 processWithLogId 方法，从失败步骤开始执行
            // 传递 isRetry = true 参数，表示这是重推操作
            const result = await this.processor.processWithLogId(zrfcLogid, zrfcid, failedStepNum, true);

            // 返回结果
            return {
                code: result.code,
                message: result.code === 'S' ? '重处理成功' : result.message,
                zrfcLogid
            };
        } catch (error) {
            throw error;
        } finally {
            // 关闭数据库事务
            await this.db.commit();
        }
    }

    /**
     * 获取失败的步骤
     * @param {string} zrfcLogid - 多步ID
     * @returns {Promise<Array>} 失败步骤列表
     */
    async getFailedSteps(zrfcLogid) {
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
        const result = await this.db.run(
            SELECT.from(MultistepLog)
                .where({ zrfc_logid: zrfcLogid, code: 'E' })
        );
        return result;
    }

    /**
     * 获取业务流程配置
     * @param {string} zrfcid - 业务流程ID
     * @returns {Promise<Object>} 业务流程配置
     */
    async getProcessConfig(zrfcid) {
        const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
        const result = await this.db.run(
            SELECT.one.from(ProcessConfig).where({ zrfcid })
        );
        return result;
    }

    /**
     * 获取步骤配置
     * @param {string} zrfcid - 业务流程ID
     * @returns {Promise<Array>} 步骤配置列表
     */
    async getSteps(zrfcid) {
        const StepConfig = cds.entities['com.sap.zictm.StepConfig'];
        const result = await this.db.run(
            SELECT.from(StepConfig).where({ zrfcid })
        );
        return result;
    }

    /**
     * 读取入参数据
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {Object} step - 步骤配置
     * @returns {Promise<Object>} 入参数据
     */
    async readInputData(zrfcLogid, zrfcid, step) {
        let readSteps = step.readsteps;
        let objkey = null;
        
        if (!readSteps) {
            // 如果读取步骤编号为空，默认读取上一步骤的对象号
            const prevStepNum = step.canum - 10;
            readSteps = prevStepNum > 0 ? prevStepNum.toString() : null;
        }

        if (readSteps) {
            // 查询多步执行日志表，获取指定步骤的对象号
            const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
            const log = await this.db.run(
                SELECT.one.from(MultistepLog)
                    .where({ zrfc_logid: zrfcLogid, zrfcid, canum: readSteps })
            );
            if (log) {
                objkey = log.objkey;
            }
        }

        // 构建标准入参格式
        return {
            zrfcid,
            canum: step.canum,
            description: step.description,
            serviceName: step.serviceName,
            readsteps: step.readsteps,
            objkey
        };
    }
}

module.exports = RetryHandler;
