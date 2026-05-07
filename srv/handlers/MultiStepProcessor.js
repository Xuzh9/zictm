const cds = require('@sap/cds');
const StepServiceFactory = require('../services/StepServiceFactory');

class MultiStepProcessor {
    constructor() {
        this.stepServiceFactory = new StepServiceFactory();
    }

    /**
     * 处理多步流程
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {number|null} startStepNum - 起始步骤编号（可选，用于重推时从失败步骤开始）
     * @param {boolean} isRetry - 是否为重推操作
     * @returns {Promise<Object>} 处理结果
     */
    async processWithLogId(zrfcLogid, zrfcid, startStepNum = null, isRetry = false) {
        let lastObjKey = '';
        let lastMessage = '';
        let lastCode = '';
        
        try {
            // 获取步骤配置
            const steps = await this.getSteps(zrfcid);
            if (!steps || steps.length === 0) {
                const errorMsg = `未找到步骤配置: zrfcid=${zrfcid}`;
                await this.saveLog(zrfcLogid, zrfcid, '0', {
                    code: 'E',
                    message: errorMsg
                }, 0, new Date(), isRetry);
                return {
                    code: 'E',
                    message: errorMsg,
                    zrfcLogid
                };
            }
            
            // 按顺序执行每个步骤
            // 先查询该 zrfcLogid 的所有日志记录，提高效率
            const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
            const allLogs = await cds.run(
                SELECT.from(MultistepLog).where({ zrfc_logid: zrfcLogid })
            );
            // 将日志记录转换为以 canum 为 key 的 Map，方便快速查找
            const logMap = {};
            for (const log of allLogs) {
                logMap[log.canum] = log;
            }
            
            for (const step of steps) {
                // 如果指定了起始步骤，跳过之前的步骤
                if (startStepNum !== null && step.canum < startStepNum) {
                    continue;
                }
                
                // 从 logMap 中查找该步骤的日志记录
                const existingLog = logMap[step.canum];
                
                // 如果日志存在且执行成功（code 为 'S'），跳过该步骤
                if (existingLog && (existingLog.code === 'S' || existingLog.code === 's')) {
                    // 更新上一步对象号，以便后续步骤使用
                    lastObjKey = existingLog.objkey || lastObjKey;
                    continue;
                }
                
                const startTime = Date.now();
                // 存储 UTC 时间，前端会根据时区自动转换显示
                const executionAt = new Date();
                
                // 执行步骤
                const executionResult = await this.executeStep(zrfcLogid, zrfcid, step, lastObjKey);
                
                const endTime = Date.now();
                const executionTime = Math.round((endTime - startTime) / 1000);
                
                // 保存日志
                const logMessage = executionResult.message ? executionResult.message.substring(0, 500) : '';
                await this.saveLog(zrfcLogid, zrfcid, step.canum, {
                    ...executionResult,
                    message: logMessage
                }, executionTime, executionAt, isRetry);

                // 更新上一步对象号、消息和代码
                lastObjKey = executionResult.objkey || lastObjKey;
                lastMessage = executionResult.message || lastMessage;
                lastCode = executionResult.code || lastCode;
                
                // 如果当前步骤失败，停止执行后续步骤
                if (executionResult.code === 'E') {
                    break;
                }
            }

            // 同步调用返回最终结果
            return {
                code: lastCode,
                message: lastMessage,
                zrfcLogid,
                objkey: lastObjKey
            };
        } catch (error) {
            // 保存错误日志
            const errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            await this.saveLog(zrfcLogid, zrfcid, '0', {
                code: 'E',
                message: errorMessage
            }, 0, new Date(), isRetry);

            return {
                code: 'E',
                message: errorMessage,
                zrfcLogid,
                objkey: lastObjKey
            };
        }
    }

    /**
     * 获取步骤配置
     * @param {string} zrfcid - 业务流程ID
     * @returns {Promise<Array>} 步骤配置列表
     */
    async getSteps(zrfcid) {
        const StepConfig = cds.entities['com.sap.zictm.StepConfig'];
        const steps = await cds.run(
            SELECT.from(StepConfig)
                .where({ process_zrfcid: zrfcid })
                .orderBy('canum')
        );
        return steps;
    }

    /**
     * 执行单个步骤
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {Object} step - 步骤配置
     * @param {string} lastObjKey - 上一步的对象号
     * @returns {Promise<Object>} 执行结果
     */
    async executeStep(zrfcLogid, zrfcid, step, lastObjKey) {
        try {
            // 使用工厂模式获取服务实例
            const service = this.stepServiceFactory.getService(step.serviceName);
            
            if (!service) {
                return {
                    code: 'E',
                    message: `服务类不存在: ${step.serviceName}`,
                    objkey: ''
                };
            }

            // 初始化服务
            await service.initService(zrfcLogid, zrfcid, step.canum);
            
            // 构建入参对象
            const inputData = {
                zrfcid,
                canum: step.canum,
                serviceName: step.serviceName,
                readsteps: step.readsteps,
                objkey: lastObjKey,
                zrfcLogid
            };
            
            // 执行服务
            const result = await service.execute(inputData);
            
            return {
                code: result.code || 'S',
                message: result.message || '执行成功',
                objkey: result.objkey || ''
            };
        } catch (error) {
            console.error(`步骤执行失败: ${step.serviceName}`, error);
            return {
                code: 'E',
                message: `步骤执行失败: ${error.message}`,
                objkey: ''
            };
        }
    }

    /**
     * 保存日志
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {string} canum - 步骤编号
     * @param {Object} executionResult - 执行结果
     * @param {number} executionTime - 执行时间（秒）
     * @param {Date} executionAt - 开始执行时间戳
     * @param {boolean} isRetry - 是否为重推操作
     */
    async saveLog(zrfcLogid, zrfcid, canum, executionResult, executionTime, executionAt, isRetry = false) {
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
        
        // 检查日志是否已存在
        const existingLog = await cds.run(
            SELECT.one.from(MultistepLog)
                .where({ zrfc_logid: zrfcLogid, zrfcid, canum: canum.toString() })
        );

        if (existingLog) {
            // 如果日志已存在，根据是否为重推操作更新不同的字段
            if (isRetry) {
                // 重推操作：只更新 lastExecutionAt 和 lastExecutionTime
                await cds.run(
                    UPDATE(MultistepLog)
                        .set({
                            code: executionResult.code,
                            message: executionResult.message,
                            objkey: executionResult.objkey,
                            lastExecutionAt: executionAt,
                            lastExecutionTime: executionTime
                        })
                        .where({ zrfc_logid: zrfcLogid, zrfcid, canum: canum.toString() })
                );
            } else {
                // 非重推操作：更新所有字段
                await cds.run(
                    UPDATE(MultistepLog)
                        .set({
                            code: executionResult.code,
                            message: executionResult.message,
                            objkey: executionResult.objkey,
                            executionTime,
                            executionAt,
                            lastExecutionAt: executionAt,
                            lastExecutionTime: executionTime
                        })
                        .where({ zrfc_logid: zrfcLogid, zrfcid, canum: canum.toString() })
                );
            }
        } else {
            // 如果日志不存在，插入新记录（首次执行）
            await cds.run(
                INSERT.into(MultistepLog).entries({
                    zrfc_logid: zrfcLogid,
                    zrfcid,
                    canum: canum.toString(),
                    code: executionResult.code,
                    message: executionResult.message,
                    objkey: executionResult.objkey,
                    executionTime,
                    executionAt,
                    lastExecutionAt: executionAt,
                    lastExecutionTime: executionTime
                })
            );
        }
    }
}

module.exports = MultiStepProcessor;
