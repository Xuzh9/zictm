const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
const MultiStepProcessor = require('./MultiStepProcessor');
const CommonUtils = require('./CommonUtils');

class RetryHandler {
    constructor() {
        this.processor = new MultiStepProcessor();
        this.commonUtils = new CommonUtils();
        this.retryingLogids = new Set(); // 用于记录正在重推的日志ID，防止重复调用
    }

    /**
     * 重处理失败的业务流程
     * @param {string} zrfcLogid - 多步ID
     * @returns {Promise<Object>} 执行结果
     */
    async retry(zrfcLogid) {
        // 检查是否正在重推中，防止重复调用
        if (this.retryingLogids.has(zrfcLogid)) {
            console.log('[RetryHandler.retry] 日志ID', zrfcLogid, '正在重推中，跳过重复调用');
            return {
                code: 'S',
                message: `日志ID${zrfcLogid}正在重推中，请稍候`,
                zrfcLogid
            };
        }
        
        // 添加到正在重推的集合中
        this.retryingLogids.add(zrfcLogid);
        
        try {
            console.log('[RetryHandler.retry] 开始重推, zrfcLogid:', zrfcLogid);
            
            // 查询多步执行日志，找到失败的步骤
            const failedSteps = await this.getFailedSteps(zrfcLogid);
            console.log('[RetryHandler.retry] 失败步骤数:', failedSteps.length);
            
            if (failedSteps.length === 0) {
                // 没有失败步骤，返回错误（包含日志ID）
                throw new Error(`日志ID${zrfcLogid}没有失败的步骤，无法重推`);
            }

            // 找到最早的失败步骤
            const firstFailedStep = failedSteps.sort((a, b) => parseInt(a.canum) - parseInt(b.canum))[0];
            const zrfcid = firstFailedStep.zrfcid;
            const failedStepNum = parseInt(firstFailedStep.canum);
            
            // 从 MPTTypeConfig 表中查询 zdfjy
            const MPTTypeConfig = cds.entities['com.sap.zictm.MPTTypeConfig'];
            const mptTypeConfig = await cds.run(
                SELECT.one.from(MPTTypeConfig).where({ zrfcid: zrfcid })
            );
            const zdfjy = mptTypeConfig?.zdfjy || null;

            // 查询 ProcessConfig 获取 isAsync 配置
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const processConfig = await cds.run(
                SELECT.one.from(ProcessConfig).where({ zrfcid: zrfcid })
            );
            const isAsync = processConfig?.isAsync || false;
            console.log('[RetryHandler.retry] 重推配置, zrfcid:', zrfcid, 'failedStepNum:', failedStepNum, 'zdfjy:', zdfjy, 'isAsync:', isAsync);

            let result;
            if (isAsync) {
                // 异步执行重推
                console.log('[RetryHandler.retry] 开始异步重推');
                this.executeAsync(zrfcLogid, zrfcid, failedStepNum, zdfjy);
                result = {
                    code: 'S',
                    message: '重推请求已提交，正在异步处理中',
                    zrfcLogid
                };
            } else {
                // 同步执行重推（传递 zdfjy）
                console.log('[RetryHandler.retry] 开始同步重推');
                result = await this.processor.processWithLogId(zrfcLogid, zrfcid, failedStepNum, true, zdfjy);
                console.log('[RetryHandler.retry] 同步重推完成, result:', result);
            }

            // 返回结果
            return {
                code: result.code,
                message: result.code === 'S' ? (isAsync ? '重推请求已提交，正在异步处理中' : '重推成功') : result.message,
                zrfcLogid
            };
        } catch (error) {
            console.error('[RetryHandler.retry] 重推失败:', error.message);
            throw error;
        } finally {
            // 无论成功还是失败，都从正在重推的集合中移除
            this.retryingLogids.delete(zrfcLogid);
        }
    }

    /**
     * 异步执行重推操作
     * @param {string} zrfcLogid - 日志ID
     * @param {string} zrfcid - 业务流程ID
     * @param {number} failedStepNum - 失败步骤编号
     * @param {string} zdfjy - 多方交易类型ID
     */
    executeAsync(zrfcLogid, zrfcid, failedStepNum, zdfjy) {
        setTimeout(async () => {
            try {
                await this.processor.processWithLogId(zrfcLogid, zrfcid, failedStepNum, true, zdfjy);
            } catch (error) {
                console.error('异步重推处理异常:', error);
            }
        }, 100);
    }

    /**
     * 获取失败的步骤（包括状态为 E、空或空字符串的步骤）
     * @param {string} zrfcLogid - 多步ID
     * @returns {Promise<Array>} 失败步骤列表
     */
    async getFailedSteps(zrfcLogid) {
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
        
        // 调试：先查询所有步骤，看看状态值是什么
        const allSteps = await cds.run(
            SELECT.from(MultistepLog).where({ zrfc_logid: zrfcLogid })
        );
        console.log('[RetryHandler.getFailedSteps] 所有步骤:', JSON.stringify(allSteps));
        
        // 获取状态为 E 或空的步骤
        const result = await cds.run(
            SELECT.from(MultistepLog).where({ 
                zrfc_logid: zrfcLogid, 
                code: { in: ['E', null, ''] } 
            })
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
        const result = await cds.run(
            SELECT.from(StepConfig).where({ zrfcid })
        );
        return result;
    }

    /**
     * 读取入参数据（使用通用工具类）
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {Object} step - 步骤配置
     * @returns {Promise<Object>} 入参数据
     */
    async readInputData(zrfcLogid, zrfcid, step) {
        // 使用通用工具类获取之前步骤的 objkey
        const objkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, step.readsteps, step.canum);

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
