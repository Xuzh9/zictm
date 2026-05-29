const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
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
     * @param {string} zdfjy - 多方交易类型ID
     * @param {string} id - ApiInputLog的ID，用于与MultistepHeadLog关联（可选）
     * @returns {Promise<Object>} 处理结果
     */
    async processWithLogId(zrfcLogid, zrfcid, startStepNum = null, isRetry = false, zdfjy = null, id = null) {
        console.log('[MultiStepProcessor.processWithLogId] 开始处理, zrfcLogid:', zrfcLogid, ', zrfcid:', zrfcid, ', zdfjy:', zdfjy, ', id:', id);
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
                }, 0, new Date(), isRetry, null, '', id);
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
            
            console.log('[MultiStepProcessor] 开始执行步骤循环，步骤数:', steps.length);
            
            for (const step of steps) {
                console.log('[MultiStepProcessor] 处理步骤:', step.canum, 'serviceName:', step.serviceName);
                
                // 如果指定了起始步骤，跳过之前的步骤
                if (startStepNum !== null && step.canum < startStepNum) {
                    console.log('[MultiStepProcessor] 跳过步骤（小于起始步骤）:', step.canum);
                    continue;
                }
                
                // 从 logMap 中查找该步骤的日志记录
                const existingLog = logMap[step.canum];
                console.log('[MultiStepProcessor] 步骤', step.canum, '已有日志:', existingLog ? existingLog.code : '无');
                
                // 如果日志存在且执行成功（code 为 'S'），跳过该步骤
                if (existingLog && (existingLog.code === 'S' || existingLog.code === 's')) {
                    // 更新上一步对象号，以便后续步骤使用
                    lastObjKey = existingLog.objkey || lastObjKey;
                    console.log('[MultiStepProcessor] 跳过步骤（已成功）:', step.canum);
                    continue;
                }
                
                console.log('[MultiStepProcessor] 执行步骤:', step.canum, 'serviceName:', step.serviceName);
                const startTime = Date.now();
                // 存储 UTC 时间，前端会根据时区自动转换显示
                const executionAt = new Date();
                
                // 执行步骤
                const executionResult = await this.executeStep(zrfcLogid, zrfcid, step, lastObjKey, zdfjy);
                console.log('[MultiStepProcessor] 步骤执行结果:', step.canum, 'code:', executionResult.code);
                
                const endTime = Date.now();
                const executionTime = Math.round((endTime - startTime) / 10) / 100;
                
                // 保存日志
                const logMessage = executionResult.message ? executionResult.message.substring(0, 500) : '';
                await this.saveLog(zrfcLogid, zrfcid, step.canum, {
                    ...executionResult,
                    message: logMessage
                }, executionTime, executionAt, isRetry, step.objtype, step.description, id, zdfjy);

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
            }, 0, new Date(), isRetry, null, '', id);

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
     * @param {string} zdfjy - 多方交易类型ID
     * @returns {Promise<Object>} 执行结果
     */
    async executeStep(zrfcLogid, zrfcid, step, lastObjKey, zdfjy = null) {
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
                zrfcLogid,
                zdfjy
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
     * @param {string} objtype - 对象类型（从StepConfig获取）
     * @param {string} description - 步骤描述（从StepConfig获取）
     * @param {string} id - ApiInputLog的ID，用于与MultistepHeadLog关联
     * @param {string} zdfjy - 多方交易类型ID
     */
    async saveLog(zrfcLogid, zrfcid, canum, executionResult, executionTime, executionAt, isRetry = false, objtype = null, description = null, id = null, zdfjy = null) {
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
        const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
         
        // 检查日志是否已存在（主键为 zrfc_logid + canum）
        const existingLog = await cds.run(
            SELECT.one.from(MultistepLog)
                .where({ zrfc_logid: zrfcLogid, canum: canum })
        );
 
        if (existingLog) {
            // 如果日志已存在，更新执行结果（executionAt 只在首次创建时设置）
            // 重推时允许更新状态为 E 或空的记录
            await cds.run(
                UPDATE(MultistepLog)
                    .set({
                        zrfcid: zrfcid,
                        code: executionResult.code,
                        message: executionResult.message,
                        objkey: executionResult.objkey,
                        objtype: objtype || existingLog.objtype,
                        description: description || existingLog.description,
                        executionTime: isRetry ? Number(existingLog.executionTime) : Number(executionTime),
                        lastExecutionAt: executionAt,
                        lastExecutionTime: Number(executionTime),
                        head_zrfc_logid: zrfcLogid
                    })
                    .where({ zrfc_logid: zrfcLogid, canum: canum })
            );
        } else {
            // 如果日志不存在，插入新记录（首次执行）
            await cds.run(
                INSERT.into(MultistepLog).entries({
                    zrfc_logid: zrfcLogid,
                    canum: canum,
                    zrfcid: zrfcid,
                    code: executionResult.code,
                    message: executionResult.message,
                    objkey: executionResult.objkey,
                    objtype: objtype || '',
                    description: description || '',
                    executionTime: Number(executionTime),
                    executionAt,
                    lastExecutionAt: executionAt,
                    lastExecutionTime: Number(executionTime),
                    head_zrfc_logid: zrfcLogid
                })
            );
        }
        
        // 同时更新 MultistepHeadLog 表
        await this.updateMultistepHeadLog(zrfcLogid, zrfcid, executionResult, executionAt, id, zdfjy);
    }
    
    /**
     * 更新多步执行日志抬头表
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {Object} executionResult - 执行结果
     * @param {Date} executionAt - 执行时间戳
     * @param {string} id - ApiInputLog的ID，用于与MultistepHeadLog关联（可选）
     * @param {string} zdfjy - 多方交易类型ID（可选）
     */
    async updateMultistepHeadLog(zrfcLogid, zrfcid, executionResult, executionAt, id = null, zdfjy = null) {
        const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
        
        // 检查抬头日志是否已存在
        const existingHeadLog = await cds.run(
            SELECT.one.from(MultistepHeadLog)
                .where({ zrfc_logid: zrfcLogid })
        );
        
        if (existingHeadLog) {
            // 如果抬头日志已存在，更新执行结果（executionAt 只在首次创建时设置）
            await cds.run(
                UPDATE(MultistepHeadLog)
                    .set({
                        id: existingHeadLog.id, // 保留原有的id（与ApiInputLog的关联不变）
                        zrfcid: zrfcid,
                        zdfjy: zdfjy || existingHeadLog.zdfjy, // 更新或保留原有的zdfjy
                        code: executionResult.code,
                        message: executionResult.message,
                        lastExecutionAt: executionAt // 只更新最后执行时间
                    })
                    .where({ zrfc_logid: zrfcLogid })
            );
        } else {
            // 如果抬头日志不存在，插入新记录（使用传入的id作为id）
            await cds.run(
                INSERT.into(MultistepHeadLog).entries({
                    zrfc_logid: zrfcLogid,
                    id: id, // 使用传入的id
                    zrfcid: zrfcid,
                    zdfjy: zdfjy,
                    code: executionResult.code,
                    message: executionResult.message,
                    executionAt,
                    lastExecutionAt: executionAt
                })
            );
        }
    }
}

module.exports = MultiStepProcessor;
