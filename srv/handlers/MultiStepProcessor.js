const cds = require('@sap/cds');

class MultiStepProcessor {
    constructor() {
        this.db = cds.transaction();
    }

    /**
     * 处理多步业务流程
     * @param {string} zrfcid - 业务流程ID
     * @param {string} inputData - 输入数据
     * @returns {Promise<Object>} 执行结果
     */
    async process(zrfcid, inputData) {
        // 生成多步ID
        const zrfcLogid = cds.utils.uuid();
        return this.processWithLogId(zrfcLogid, zrfcid, inputData);
    }

    /**
     * 使用指定的多步ID处理业务流程
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {string} inputData - 输入数据
     * @returns {Promise<Object>} 执行结果
     */
    async processWithLogId(zrfcLogid, zrfcid, inputData) {
        try {
            // 查询业务流程配置
            const processConfig = await this.getProcessConfig(zrfcid);
            if (!processConfig) {
                throw new Error(`业务流程配置不存在: ${zrfcid}`);
            }

            // 查询步骤配置
            const steps = await this.getSteps(zrfcid);
            if (steps.length === 0) {
                throw new Error(`业务流程无步骤配置: ${zrfcid}`);
            }

            // 按步骤编号排序
            steps.sort((a, b) => a.canum - b.canum);

            // 执行每一步
            let lastObjKey = null;
            for (const step of steps) {
                // 读取入参数据
                const stepInputData = await this.readInputData(zrfcLogid, zrfcid, step);
                
                // 调用方法
                const startTime = Date.now();
                let executionResult;
                try {
                    executionResult = await this.invokeMethod(step.method, stepInputData);
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
                await this.saveLog(zrfcLogid, zrfcid, step.canum, stepInputData, executionResult, executionTime);

                // 更新上一步对象号
                lastObjKey = executionResult.objkey || lastObjKey;

                // 如果执行失败，抛出异常
                if (executionResult.code === 'E') {
                    throw new Error(executionResult.message);
                }
            }

            // 如果是异步调用，直接返回成功
            if (processConfig.isAsync) {
                return {
                    code: 'S',
                    message: '调用成功',
                    zrfcLogid
                };
            }

            // 同步调用返回最终结果
            return {
                code: 'S',
                message: '执行成功',
                zrfcLogid
            };
        } catch (error) {
            // 保存错误日志
            await this.saveLog(zrfcLogid, zrfcid, '0', inputData, {
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
                return JSON.parse(log.inputData || '{}');
            }
        }

        return {};
    }

    /**
     * 调用方法
     * @param {string} method - 方法名
     * @param {Object} inputData - 输入数据
     * @returns {Promise<Object>} 调用结果
     */
    async invokeMethod(method, inputData) {
        // 这里需要根据实际的方法名调用对应的业务逻辑
        // 暂时返回默认成功结果
        return {
            code: 'S',
            message: '方法调用成功',
            objkey: `OBJ${Date.now()}`
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
    async saveLog(zrfcLogid, zrfcid, canum, inputData, executionResult, executionTime) {
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
                        inputData: JSON.stringify(inputData),
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
                    inputData: JSON.stringify(inputData),
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

module.exports = MultiStepProcessor;