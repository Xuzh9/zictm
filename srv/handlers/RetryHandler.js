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
     * @param {string} inputData - 输入数据
     * @returns {Promise<Object>} 执行结果
     */
    async retry(zrfcLogid, inputData) {
        try {
            // 查询多步执行日志，找到失败的步骤
            const failedSteps = await this.getFailedSteps(zrfcLogid);
            
            if (failedSteps.length === 0) {
                // 没有失败步骤，停止执行
                return {
                    code: 'S',
                    message: '没有失败步骤，无需重处理',
                    zrfcLogid
                };
            }

            // 找到最早的失败步骤
            const firstFailedStep = failedSteps.sort((a, b) => parseInt(a.canum) - parseInt(b.canum))[0];
            const zrfcid = firstFailedStep.zrfcid;
            const failedStepNum = parseInt(firstFailedStep.canum);

            // 查询业务流程配置
            const processConfig = await this.getProcessConfig(zrfcid);
            if (!processConfig) {
                throw new Error(`业务流程配置不存在: ${zrfcid}`);
            }

            // 查询所有步骤配置
            const allSteps = await this.getSteps(zrfcid);
            if (allSteps.length === 0) {
                throw new Error(`业务流程无步骤配置: ${zrfcid}`);
            }

            // 按步骤编号排序
            allSteps.sort((a, b) => a.canum - b.canum);

            // 从失败步骤开始执行
            let lastObjKey = null;
            for (const step of allSteps) {
                // 跳过失败步骤之前的步骤
                if (step.canum < failedStepNum) {
                    continue;
                }

                // 读取入参数据
                const stepInputData = await this.readInputData(zrfcLogid, zrfcid, step);
                
                // 调用方法
                const startTime = Date.now();
                let executionResult;
                try {
                    executionResult = await this.processor.invokeMethod(step.method, stepInputData);
                } catch (error) {
                    executionResult = {
                        code: 'E',
                        message: error.message,
                        objkey: lastObjKey
                    };
                }
                const endTime = Date.now();
                const executionTime = (endTime - startTime) / 1000;

                // 保存日志
                await this.saveLog(zrfcLogid, zrfcid, step.canum, executionResult, executionTime);

                // 更新上一步对象号
                lastObjKey = executionResult.objkey || lastObjKey;

                // 如果执行失败，抛出异常
                if (executionResult.code === 'E') {
                    throw new Error(executionResult.message);
                }
            }

            // 返回成功结果
            return {
                code: 'S',
                message: '重处理成功',
                zrfcLogid
            };
        } catch (error) {
            // 保存错误日志
            await this.saveLog(zrfcLogid, '', '0', {
                code: 'E',
                message: error.message
            }, 0);

            return {
                code: 'E',
                message: error.message,
                zrfcLogid
            };
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

    /**
     * 保存日志
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {number} canum - 步骤编号
     * @param {Object} inputData - 输入数据
     * @param {Object} executionResult - 执行结果
     * @param {number} executionTime - 执行时间
     */
    async saveLog(zrfcLogid, zrfcid, canum, executionResult, executionTime) {
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
        
        // 检查日志是否已存在
        const existingLog = await this.db.run(
            SELECT.one.from(MultistepLog)
                .where({ zrfc_logid: zrfcLogid, zrfcid, canum: canum.toString() })
        );

        if (existingLog) {
            // 如果日志已存在，更新消息（拼接）
            const updatedMessage = existingLog.message ? 
                `${existingLog.message}; ${executionResult.message}` : 
                executionResult.message;
            
            await this.db.run(
                UPDATE(MultistepLog)
                    .set({
                        code: executionResult.code,
                        message: updatedMessage,
                        objkey: executionResult.objkey,
                        executionTime,
                        modifiedAt: new Date(),
                        modifiedBy: 'SYSTEM'
                    })
                    .where({ zrfc_logid: zrfcLogid, zrfcid, canum: canum.toString() })
            );
        } else {
            // 如果日志不存在，插入新记录
            await this.db.run(
                INSERT.into(MultistepLog).entries({
                    zrfc_logid: zrfcLogid,
                    zrfcid,
                    canum: canum.toString(),
                    code: executionResult.code,
                    message: executionResult.message,
                    objkey: executionResult.objkey,
                    executionTime,
                    createdAt: new Date(),
                    createdBy: 'SYSTEM',
                    modifiedAt: new Date(),
                    modifiedBy: 'SYSTEM'
                })
            );
        }
    }
}

module.exports = RetryHandler;