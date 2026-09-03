const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
const StepServiceFactory = require('../services/StepServiceFactory');

class MultiStepProcessor {
    constructor() {
        this.stepServiceFactory = new StepServiceFactory();
    }

    /**
     * 准备前置数据（校验 + 保存 HeadLog + 业务表 + 初始 MultistepLog）
     * 在调用步骤执行前由 MultiStepInvoker 调用
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {Object} processConfig - 业务流程配置
     * @param {Array} businessTable1 - 业务表1数据
     * @param {Array} businessTable2 - 业务表2数据
     * @param {Array} businessTable3 - 业务表3数据
     * @param {string} zdfjy - 多方交易类型ID
     * @param {string} id - ApiInputLog的ID
     * @param {boolean} isRetry - 是否为重推
     * @returns {Promise<Object>} 准备结果 { code, message, steps }
     */
    async prepareProcessing(zrfcLogid, zrfcid, processConfig, businessTable1, businessTable2, businessTable3, zdfjy = null, id = null, isRetry = false) {
        const executionAt = new Date();

        try {
            // 1. 获取步骤配置（只读，在事务外）
            const steps = await this.getSteps(zrfcid);
            if (!steps || steps.length === 0) {
                const errorMsg = `未找到步骤配置: zrfcid=${zrfcid}`;
                console.error('[MultiStepProcessor.prepareProcessing]', errorMsg);
                return { code: 'E', message: errorMsg, steps: [] };
            }
            const firstStepCanum = String(steps[0].canum);

            // 2. 校验业务数据（只读，在事务外）
            if (processConfig && !isRetry) {
                const validateResult = await this.validateBusinessDataBeforeInsert(processConfig, businessTable1, businessTable2, businessTable3);
                if (!validateResult.valid) {
                    const errorMsg = validateResult.error;
                    console.error('[MultiStepProcessor.prepareProcessing]', errorMsg);
                    return { code: 'E', message: errorMsg, steps: [] };
                }
            }

            // 3. 三张表操作放在同一个事务：业务表 + HeadLog(P) + 第一步日志(P)
            if (!isRetry && processConfig) {
                await cds.tx(async (tx) => {
                    // 3a. 插入业务表数据
                    await this.insertBusinessDataByConfigWithTx(tx, processConfig, businessTable1, businessTable2, businessTable3, zrfcid, zrfcLogid, zdfjy);
                    console.log('[MultiStepProcessor.prepareProcessing] 业务表插入成功');

                    // 3b. 保存 HeadLog（进行中）
                    await tx.run(
                        INSERT.into(cds.entities['com.sap.zictm.MultistepHeadLog']).entries({
                            zrfc_logid: zrfcLogid,
                            zrfcid: zrfcid,
                            zdfjy: zdfjy || null,
                            objkey: '',
                            code: 'P',
                            message: '处理中',
                            executionAt: executionAt,
                            lastExecutionAt: executionAt,
                            id: id || null
                        })
                    );
                    console.log('[MultiStepProcessor.prepareProcessing] HeadLog 保存成功');

                    // 3c. 保存第一步日志（占位，状态P）
                    await tx.run(
                        INSERT.into(cds.entities['com.sap.zictm.MultistepLog']).entries({
                            zrfc_logid: zrfcLogid,
                            canum: firstStepCanum,
                            zrfcid: zrfcid,
                            code: 'P',
                            message: '待执行',
                            objkey: '',
                            objtype: '',
                            description: steps[0]?.description || '',
                            executionTime: 0,
                            executionAt: executionAt,
                            lastExecutionAt: executionAt,
                            lastExecutionTime: 0,
                            head_zrfc_logid: zrfcLogid
                        })
                    );
                    console.log(`[MultiStepProcessor.prepareProcessing] 第一步日志保存成功, canum: ${firstStepCanum}`);
                });
            } else {
                // 重推模式：只更新业务表，不创建新 HeadLog/StepLog
                console.log('[MultiStepProcessor.prepareProcessing] 重推模式，跳过前置数据保存');
            }

            return { code: 'S', message: '前置数据保存成功', steps };
        } catch (error) {
            console.error('[MultiStepProcessor.prepareProcessing] 异常:', error);
            return { code: 'E', message: error.message || '前置数据保存失败', steps: [] };
        }
    }

    /**
     * 处理多步流程
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {number|null} startStepNum - 起始步骤编号（可选，用于重推时从失败步骤开始）
     * @param {boolean} isRetry - 是否为重推操作
     * @param {string} zdfjy - 多方交易类型ID
     * @param {string} id - ApiInputLog的ID，用于与MultistepHeadLog关联（可选）
     * @param {Object} processConfig - 业务流程配置
     * @param {Array} businessTable1 - 业务表1数据
     * @param {Array} businessTable2 - 业务表2数据
     * @param {Array} businessTable3 - 业务表3数据
     * @returns {Promise<Object>} 处理结果
     */
    async processWithLogId(zrfcLogid, zrfcid, startStepNum = null, isRetry = false, zdfjy = null, id = null, processConfig = null, businessTable1 = null, businessTable2 = null, businessTable3 = null, skipPreparation = false) {
        console.log('[MultiStepProcessor.processWithLogId] 开始处理, zrfcLogid:', zrfcLogid, ', zrfcid:', zrfcid, ', zdfjy:', zdfjy, ', id:', id);
        let lastObjKey = '';
        let lastMessage = '';
        let lastCode = '';
        let lastStepCanum = null;
        
        try {
            // 定义执行时间
            const executionAt = new Date();
            let steps;
            let firstStepCanum = '0';
            
            if (!skipPreparation) {
                // 1. 获取步骤配置（只读，在事务外）
                steps = await this.getSteps(zrfcid);
                if (steps && steps.length > 0) {
                    firstStepCanum = String(steps[0].canum);
                }
                if (!steps || steps.length === 0) {
                    const errorMsg = `未找到步骤配置: zrfcid=${zrfcid}`;
                    console.error('[MultiStepProcessor.processWithLogId]', errorMsg);
                    return { code: 'E', message: errorMsg, zrfcLogid };
                }
                
                // 2. 校验业务数据（只读，在事务外）
                if (processConfig && !isRetry) {
                    const validateResult = await this.validateBusinessDataBeforeInsert(processConfig, businessTable1, businessTable2, businessTable3);
                    if (!validateResult.valid) {
                        const errorMsg = validateResult.error;
                        console.error('[MultiStepProcessor.processWithLogId]', errorMsg);
                        return { code: 'E', message: errorMsg, zrfcLogid };
                    }
                }
                
                // 3. 三张表操作放在同一个事务：业务表 + HeadLog(P) + 第一步日志(P)
                if (!isRetry && processConfig) {
                    await cds.tx(async (tx) => {
                        // 3a. 插入业务表数据
                        await this.insertBusinessDataByConfigWithTx(tx, processConfig, businessTable1, businessTable2, businessTable3, zrfcid, zrfcLogid, zdfjy);
                        console.log('[MultiStepProcessor.processWithLogId] 业务表插入成功');

                        // 3b. 保存 HeadLog（进行中）
                        await tx.run(
                            INSERT.into(cds.entities['com.sap.zictm.MultistepHeadLog']).entries({
                                zrfc_logid: zrfcLogid,
                                zrfcid: zrfcid,
                                zdfjy: zdfjy || null,
                                objkey: '',
                                code: 'P',
                                message: '处理中',
                                executionAt: executionAt,
                                lastExecutionAt: executionAt,
                                id: id || null
                            })
                        );
                        console.log('[MultiStepProcessor.processWithLogId] HeadLog 保存成功');

                        // 3c. 保存第一步日志（占位，状态P）
                        await tx.run(
                            INSERT.into(cds.entities['com.sap.zictm.MultistepLog']).entries({
                                zrfc_logid: zrfcLogid,
                                canum: firstStepCanum,
                                zrfcid: zrfcid,
                                code: 'P',
                                message: '待执行',
                                objkey: '',
                                objtype: '',
                                description: steps[0]?.description || '',
                                executionTime: 0,
                                executionAt: executionAt,
                                lastExecutionAt: executionAt,
                                lastExecutionTime: 0,
                                head_zrfc_logid: zrfcLogid
                            })
                        );
                        console.log(`[MultiStepProcessor.processWithLogId] 第一步日志保存成功, canum: ${firstStepCanum}`);
                    });
                } else if (isRetry && processConfig && businessTable1 && Array.isArray(businessTable1) && businessTable1.length > 0) {
                    // 重推模式：更新业务表（事务外，因为 HeadLog/StepLog 已存在）
                    console.log('[MultiStepProcessor.processWithLogId] 重推时更新业务表数据');
                    await this.updateBusinessDataByConfig(null, processConfig, businessTable1, businessTable2, businessTable3, zrfcid, zrfcLogid, zdfjy);
                } else {
                    console.log('[MultiStepProcessor.processWithLogId] 重推模式，跳过业务表更新');
                }
            } // end of skipPreparation block

            // skipPreparation 时需要获取 steps（已由 prepareProcessing 保存了前置数据）
            if (skipPreparation && (!steps || steps.length === 0)) {
                steps = await this.getSteps(zrfcid);
            }
            
            // 不再单独重置 HeadLog 为 P：如果步骤循环执行前崩溃，会导致 HeadLog=P 但 StepLog 没更新的不一致
            // HeadLog 状态统一由 finalizeHeadAndStepLog 原子事务更新（成功→S，失败→E）
            
            // 4. 先查询该 zrfcLogid 的所有日志记录，提高效率
            const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
            let allLogs = [];
            try {
                allLogs = await cds.run(
                    SELECT.from(MultistepLog).where({ zrfc_logid: zrfcLogid })
                );
            } catch (logQueryError) {
                console.error('[MultiStepProcessor.processWithLogId] 查询已有日志失败:', logQueryError.message);
                // 查询失败时继续执行，步骤会重新保存日志
            }
            const logMap = {};
            for (const log of allLogs) {
                logMap[log.canum] = log;
            }
            
            console.log('[MultiStepProcessor] 开始执行步骤循环，步骤数:', steps.length);
            
            // 5. 按顺序执行每个步骤
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
                    // 更新上一步对象号、消息和代码，以便后续步骤使用
                    lastObjKey = existingLog.objkey !== undefined ? existingLog.objkey : lastObjKey;
                    lastMessage = existingLog.message || lastMessage;
                    lastCode = existingLog.code || lastCode;
                    lastStepCanum = step.canum;
                    console.log('[MultiStepProcessor] 跳过步骤（已成功）:', step.canum);
                    continue;
                }
                
                console.log('[MultiStepProcessor] 执行步骤:', step.canum, 'serviceName:', step.serviceName);
                const startTime = Date.now();
                const stepExecutionAt = new Date();
                
                // 执行步骤（在事务内执行）
                let executionResult;
                try {
                    executionResult = await this.executeStepWithTx(zrfcLogid, zrfcid, step, lastObjKey, zdfjy);
                    console.log('[MultiStepProcessor] 步骤执行结果:', step.canum, 'code:', executionResult.code);
                } catch (stepError) {
                    // 步骤执行抛出异常，标记为失败
                    executionResult = {
                        code: 'E',
                        message: `步骤执行异常: ${stepError.message}`,
                        objkey: ''
                    };
                    console.error('[MultiStepProcessor] 步骤执行异常:', step.canum, stepError.message);
                }
                
                const endTime = Date.now();
                const executionTime = Math.round((endTime - startTime) / 10) / 100;
                
                // 保存步骤日志（事务外保存，确保一定保存）
                const logMessage = executionResult.message ? executionResult.message.substring(0, 500) : '';
                try {
                    await this.saveLog(null, zrfcLogid, zrfcid, step.canum, {
                        ...executionResult,
                        message: logMessage
                    }, executionTime, stepExecutionAt, isRetry, step.objtype, step.description);
                    console.log('[MultiStepProcessor] 步骤日志保存成功:', step.canum);
                } catch (logError) {
                    console.error(`[MultiStepProcessor] 步骤日志保存失败: ${step.canum}`, logError.message);
                }
                
                // 更新上一步对象号、消息和代码
                // 注意：objkey 为空字符串时不继承上一步，直接留空
                lastObjKey = executionResult.objkey !== undefined ? executionResult.objkey : lastObjKey;
                lastMessage = executionResult.message || lastMessage;
                lastCode = executionResult.code || lastCode;
                lastStepCanum = step.canum;
                
                // 如果当前步骤失败，停止执行后续步骤
                if (executionResult.code === 'E') {
                    console.log('[MultiStepProcessor] 步骤失败，停止执行:', step.canum);
                    
                    // 只有 SalesOrderAsyncResultService 失败时，才将上一步骤更新为失败状态
                    // 因为异步调用的 URL 一旦获取到结果就会失效，需要重新执行创建步骤
                    // 使用 step.readsteps 获取上一步步骤编号
                    if (step.serviceName === 'SalesOrderAsyncResultService' && step.readsteps) {
                        console.log('[MultiStepProcessor] 将上一步骤', step.readsteps, '更新为失败状态');
                        try {
                            await this.saveLog(null, zrfcLogid, zrfcid, step.readsteps, {
                                code: 'E',
                                message: '后续步骤失败，需重新执行',
                                objkey: ''
                            }, 0, new Date(), isRetry);
                        } catch (prevLogError) {
                            console.error('[MultiStepProcessor] 更新上一步骤失败:', prevLogError.message);
                        }
                    }
                    
                    // 原子更新 HeadLog + 失败步骤日志（同一事务，确保一致性）
                    try {
                        await this.finalizeHeadAndStepLog(
                            zrfcLogid, zrfcid, step.canum, 'E',
                            lastMessage || '处理失败', lastObjKey, executionAt
                        );
                    } catch (finalizeError) {
                        console.error('[MultiStepProcessor] 原子更新失败:', finalizeError.message, ', 尝试兜底...');
                        try {
                            await cds.run(
                                UPDATE(cds.entities['com.sap.zictm.MultistepHeadLog'])
                                    .set({ code: 'E', message: (lastMessage || '处理失败').substring(0, 500), lastExecutionAt: executionAt })
                                    .where({ zrfc_logid: zrfcLogid })
                            );
                        } catch (fallbackError) {
                            console.error('[MultiStepProcessor] HeadLog 兜底更新也失败:', fallbackError.message);
                        }
                    }
                    break;
                }
            }
            
            // 6. 如果所有步骤都成功，原子更新 HeadLog + 最后步骤日志（同一事务，确保一致性）
            if (lastCode !== 'E') {
                try {
                    await this.finalizeHeadAndStepLog(
                        zrfcLogid, zrfcid, lastStepCanum, 'S',
                        lastMessage || '处理成功', lastObjKey, executionAt
                    );
                } catch (finalizeError) {
                    console.error('[MultiStepProcessor.processWithLogId] 原子更新失败:', finalizeError.message, ', 尝试兜底...');
                    try {
                        await cds.run(
                            UPDATE(cds.entities['com.sap.zictm.MultistepHeadLog'])
                                .set({ code: 'S', message: (lastMessage || '处理成功').substring(0, 500), lastExecutionAt: executionAt })
                                .where({ zrfc_logid: zrfcLogid })
                        );
                    } catch (fallbackError) {
                        console.error('[MultiStepProcessor] HeadLog 兜底更新也失败:', fallbackError.message);
                    }
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
            // 原子更新 HeadLog + 错误步骤日志（同一事务，确保一致性）
            const errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            try {
                await this.finalizeHeadAndStepLog(
                    zrfcLogid, zrfcid, firstStepCanum, 'E',
                    errorMessage, lastObjKey, new Date()
                );
                console.log(`[MultiStepProcessor.processWithLogId] 错误原子更新成功, zrfcLogid: ${zrfcLogid}`);
            } catch (finalizeError) {
                console.error(`[MultiStepProcessor.processWithLogId] 原子更新失败: ${finalizeError.message}, 尝试兜底...`);
                // 兜底：直接用 cds.run 更新
                try {
                    const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
                    await cds.run(
                        UPDATE(MultistepHeadLog)
                            .set({
                                code: 'E',
                                message: errorMessage.substring(0, 500),
                                lastExecutionAt: new Date()
                            })
                            .where({ zrfc_logid: zrfcLogid })
                    );
                    console.log('[MultiStepProcessor.processWithLogId] HeadLog 兜底更新成功');
                } catch (fallbackError) {
                    console.error('[MultiStepProcessor.processWithLogId] HeadLog 兜底更新也失败:', fallbackError.message);
                }
            }

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
     * @param {Object} [tx] - 事务对象（可选）
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {string} canum - 步骤编号
     * @param {Object} executionResult - 执行结果
     * @param {number} executionTime - 执行时间（秒）
     * @param {Date} executionAt - 开始执行时间戳
     * @param {boolean} isRetry - 是否为重推操作
     * @param {string} objtype - 对象类型（从StepConfig获取）
     * @param {string} description - 步骤描述（从StepConfig获取）
     */
    async saveLog(tx, zrfcLogid, zrfcid, canum, executionResult, executionTime, executionAt, isRetry = false, objtype = null, description = null) {
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
        
        // 截断 message 字段，确保不超过 5000 字符
        const truncatedMessage = executionResult.message ? executionResult.message.substring(0, 5000) : '';

        // 定义保存日志的核心逻辑
        const doSave = async (currentTx) => {
            await this._saveLogInternal(currentTx, MultistepLog, zrfcLogid, zrfcid, canum, executionResult, truncatedMessage, executionTime, executionAt, isRetry, objtype, description);
        };

        // 如果没有传入事务对象，创建一个新的独立事务来保存日志
        // 这在事务失败后的 catch 块中非常重要，确保错误日志能够被记录
        if (!tx) {
            await cds.tx(doSave);
        } else {
            // 使用传入的事务对象保存日志
            await doSave(tx);
        }
    }

    /**
     * 内部方法：保存日志的实际逻辑
     */
    async _saveLogInternal(tx, MultistepLog, zrfcLogid, zrfcid, canum, executionResult, truncatedMessage, executionTime, executionAt, isRetry, objtype, description) {
        // 检查日志是否已存在（主键为 zrfc_logid + canum）
        const existingLog = await tx.run(
            SELECT.one.from(MultistepLog)
                .where({ zrfc_logid: zrfcLogid, canum: canum })
        );
 
        if (existingLog) {
            // 如果日志已存在，更新执行结果（executionAt 只在首次创建时设置）
            // 重推时允许更新状态为 E 或空的记录
            await tx.run(
                UPDATE(MultistepLog)
                    .set({
                        zrfcid: zrfcid,
                        code: executionResult.code,
                        message: truncatedMessage,
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
            await tx.run(
                INSERT.into(MultistepLog).entries({
                    zrfc_logid: zrfcLogid,
                    canum: canum,
                    zrfcid: zrfcid,
                    code: executionResult.code,
                    message: truncatedMessage,
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
    }

    /**
     * 原子更新抬头日志和步骤日志（放在同一个事务中，确保一致性）
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {string} canum - 步骤编号
     * @param {string} code - 状态码 (S:成功, E:失败)
     * @param {string} message - 消息
     * @param {string} objkey - 对象号
     * @param {Date} executionAt - 执行时间
     */
    async finalizeHeadAndStepLog(zrfcLogid, zrfcid, canum, code, message, objkey, executionAt) {
        const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
        
        await cds.tx(async (tx) => {
            // 1. 更新抬头日志
            await tx.run(
                UPDATE(MultistepHeadLog)
                    .set({ 
                        code: code, 
                        message: message ? message.substring(0, 500) : '', 
                        lastExecutionAt: executionAt 
                    })
                    .where({ zrfc_logid: zrfcLogid })
            );
            
            // 2. 更新最后一个步骤日志（跟抬头保持一致）
            if (canum) {
                await tx.run(
                    UPDATE(MultistepLog)
                        .set({ 
                            code: code, 
                            message: message ? message.substring(0, 500) : '',
                            objkey: objkey || ''
                        })
                        .where({ zrfc_logid: zrfcLogid, canum: canum })
                );
            }
        });
        
        console.log(`[MultiStepProcessor.finalizeHeadAndStepLog] 原子更新成功, zrfcLogid: ${zrfcLogid}, code: ${code}, canum: ${canum}`);
    }

    /**
     * 保存抬头日志（事务外保存）
     * @param {Object} [tx] - 事务对象（可选）
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {string} zdfjy - 多方交易类型ID
     * @param {string} id - ApiInputLog的ID
     * @param {string} code - 状态码 (P:进行中, S:成功, E:失败)
     * @param {string} message - 消息
     * @param {Date} executionAt - 执行时间
     */
    async saveHeadLog(tx, zrfcLogid, zrfcid, zdfjy, id, code, message, executionAt) {
        const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
        
        const doSave = async (currentTx) => {
            const existingHeadLog = await currentTx.run(
                SELECT.one.from(MultistepHeadLog).where({ zrfc_logid: zrfcLogid })
            );
            
            if (existingHeadLog) {
                // 更新现有记录
                await currentTx.run(
                    UPDATE(MultistepHeadLog)
                        .set({
                            code: code,
                            message: message ? message.substring(0, 500) : '',
                            lastExecutionAt: executionAt
                        })
                        .where({ zrfc_logid: zrfcLogid })
                );
            } else {
                // 插入新记录
                await currentTx.run(
                    INSERT.into(MultistepHeadLog).entries({
                        zrfc_logid: zrfcLogid,
                        zrfcid: zrfcid,
                        zdfjy: zdfjy || null,
                        objkey: '',
                        code: code,
                        message: message ? message.substring(0, 500) : '',
                        executionAt: executionAt,
                        lastExecutionAt: executionAt,
                        id: id || null
                    })
                );
            }
        };

        if (!tx) {
            await cds.tx(doSave);
        } else {
            await doSave(tx);
        }
    }

    /**
     * 带事务的步骤执行
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {Object} step - 步骤配置
     * @param {string} lastObjKey - 上一步的对象号
     * @param {string} zdfjy - 多方交易类型ID
     * @returns {Promise<Object>} 执行结果
     */
    async executeStepWithTx(zrfcLogid, zrfcid, step, lastObjKey, zdfjy = null) {
        return await cds.tx(async (tx) => {
            const service = this.stepServiceFactory.getService(step.serviceName);
            
            if (!service) {
                return {
                    code: 'E',
                    message: `服务类不存在: ${step.serviceName}`,
                    objkey: ''
                };
            }

            await service.initService(zrfcLogid, zrfcid, step.canum);
            
            const inputData = {
                zrfcid,
                canum: step.canum,
                serviceName: step.serviceName,
                readsteps: step.readsteps,
                objkey: lastObjKey,
                zrfcLogid,
                zdfjy
            };
            
            const result = await service.execute(inputData);
            
            return {
                code: result.code || 'S',
                message: result.message || '执行成功',
                objkey: result.objkey || ''
            };
        });
    }
    
    /**
     * 插入业务数据（按配置，不使用事务）
     * @param {Object} processConfig - 业务流程配置
     * @param {Array} businessTable1Data - 业务表1数据
     * @param {Array} businessTable2Data - 业务表2数据
     * @param {Array} businessTable3Data - 业务表3数据
     * @param {string} zrfcid - 业务流程ID
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zdfjy - 多方交易类型ID
     */
    async insertBusinessDataByConfig(processConfig, businessTable1Data, businessTable2Data, businessTable3Data, zrfcid, zrfcLogid, zdfjy = null) {
        try {
            // 处理 businessTable1
            if (processConfig.businessTable1 && businessTable1Data) {
                const table1Data = businessTable1Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                const BusinessEntity1 = cds.entities[`com.sap.zictm.${processConfig.businessTable1}`];
                await cds.run(INSERT.into(BusinessEntity1).entries(table1Data));
                console.log(`[insertBusinessDataByConfig] 插入业务表成功: ${processConfig.businessTable1}, 数据量: ${table1Data.length}`);
            }

            // 处理 businessTable2
            if (processConfig.businessTable2 && businessTable2Data) {
                const table2Data = businessTable2Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                const BusinessEntity2 = cds.entities[`com.sap.zictm.${processConfig.businessTable2}`];
                await cds.run(INSERT.into(BusinessEntity2).entries(table2Data));
                console.log(`[insertBusinessDataByConfig] 插入业务表成功: ${processConfig.businessTable2}, 数据量: ${table2Data.length}`);
            }

            // 处理 businessTable3
            if (processConfig.businessTable3 && businessTable3Data) {
                const table3Data = businessTable3Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                const BusinessEntity3 = cds.entities[`com.sap.zictm.${processConfig.businessTable3}`];
                await cds.run(INSERT.into(BusinessEntity3).entries(table3Data));
                console.log(`[insertBusinessDataByConfig] 插入业务表成功: ${processConfig.businessTable3}, 数据量: ${table3Data.length}`);
            }
        } catch (error) {
            console.error('[insertBusinessDataByConfig] 按配置插入业务数据失败:', error);
            throw error;
        }
    }

    /**
     * 使用事务插入业务数据（按配置）
     * @param {Object} tx - 事务对象
     * @param {Object} processConfig - 业务流程配置
     * @param {Array} businessTable1Data - 业务表1数据
     * @param {Array} businessTable2Data - 业务表2数据
     * @param {Array} businessTable3Data - 业务表3数据
     * @param {string} zrfcid - 业务流程ID
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zdfjy - 多方交易类型ID
     */
    async insertBusinessDataByConfigWithTx(tx, processConfig, businessTable1Data, businessTable2Data, businessTable3Data, zrfcid, zrfcLogid, zdfjy = null) {
        try {
            // 处理 businessTable1
            if (processConfig.businessTable1 && businessTable1Data) {
                const table1Data = businessTable1Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.insertBusinessDataWithTx(tx, processConfig.businessTable1, table1Data);
            }

            // 处理 businessTable2
            if (processConfig.businessTable2 && businessTable2Data) {
                const table2Data = businessTable2Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.insertBusinessDataWithTx(tx, processConfig.businessTable2, table2Data);
            }

            // 处理 businessTable3
            if (processConfig.businessTable3 && businessTable3Data) {
                const table3Data = businessTable3Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.insertBusinessDataWithTx(tx, processConfig.businessTable3, table3Data);
            }
        } catch (error) {
            console.error('[insertBusinessDataByConfigWithTx] 按配置插入业务数据失败:', error);
            throw error;
        }
    }

    /**
     * 统一校验业务数据（在插入表之前执行）
     * @param {Object} processConfig - 业务流程配置
     * @param {Array} businessTable1Data - 业务表1数据
     * @param {Array} businessTable2Data - 业务表2数据
     * @param {Array} businessTable3Data - 业务表3数据
     * @returns {Object} { valid: boolean, error: string }
     */
    async validateBusinessDataBeforeInsert(processConfig, businessTable1Data, businessTable2Data, businessTable3Data) {
        const tables = [
            { name: processConfig.businessTable1, data: businessTable1Data },
            { name: processConfig.businessTable2, data: businessTable2Data },
            { name: processConfig.businessTable3, data: businessTable3Data }
        ];
        
        let hasValidTable = false;
        
        for (const table of tables) {
            const { name: tableName, data } = table;
            
            if (!tableName) {
                continue;
            }
            
            if (!data || !Array.isArray(data) || data.length === 0) {
                continue;
            }
            
            hasValidTable = true;
            
            const BusinessEntity = cds.entities[`com.sap.zictm.${tableName}`];
            if (!BusinessEntity) {
                return { valid: false, error: `业务表不存在: ${tableName}` };
            }
        }
        
        if (!hasValidTable) {
            return { valid: false, error: '业务表配置无效：businessTable1、businessTable2、businessTable3 均未维护或数据为空' };
        }
        
        return { valid: true, error: null };
    }

    /**
     * 使用事务插入业务数据（校验已在 validateBusinessDataBeforeInsert 中统一完成）
     * @param {Object} tx - 事务对象
     * @param {string} tableName - 业务表名
     * @param {Array} data - 业务数据
     */
    async insertBusinessDataWithTx(tx, tableName, data) {
        try {
            const BusinessEntity = cds.entities[`com.sap.zictm.${tableName}`];
            await tx.run(INSERT.into(BusinessEntity).entries(data));
            console.log(`[insertBusinessDataWithTx] 插入业务表成功: ${tableName}, 数据量: ${data.length}`);
        } catch (error) {
            console.error(`[insertBusinessDataWithTx] 插入业务表失败: ${tableName}`, error);
            throw error;
        }
    }

    /**
     * 根据 ProcessConfig 配置分别更新 businessTable1、businessTable2、businessTable3 对应的数据表（覆盖更新）
     * @param {Object} [tx] - 事务对象（可选）
     * @param {Object} processConfig - 业务流程配置
     * @param {Array} businessTable1Data - 业务表1的数据
     * @param {Array} businessTable2Data - 业务表2的数据
     * @param {Array} businessTable3Data - 业务表3的数据
     * @param {string} zrfcid - 业务流程ID
     * @param {string} zrfcLogid - 日志ID
     * @param {string} zdfjy - 多方交易类型ID（可选）
     */
    async updateBusinessDataByConfig(tx, processConfig, businessTable1Data, businessTable2Data, businessTable3Data, zrfcid, zrfcLogid, zdfjy = null) {
        try {
            if (!processConfig) {
                console.warn('[updateBusinessDataByConfig] processConfig 为空，跳过更新业务数据');
                return;
            }

            // 处理 businessTable1
            if (processConfig.businessTable1 && businessTable1Data) {
                const table1Data = businessTable1Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.updateBusinessData(tx, processConfig.businessTable1, table1Data);
            }

            // 处理 businessTable2
            if (processConfig.businessTable2 && businessTable2Data) {
                const table2Data = businessTable2Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.updateBusinessData(tx, processConfig.businessTable2, table2Data);
            }

            // 处理 businessTable3
            if (processConfig.businessTable3 && businessTable3Data) {
                const table3Data = businessTable3Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.updateBusinessData(tx, processConfig.businessTable3, table3Data);
            }
        } catch (error) {
            console.error('[updateBusinessDataByConfig] 更新业务数据失败:', error);
            throw error;
        }
    }

    /**
     * 更新业务数据表（包含 zrfcid 和 zrfc_logid 字段，覆盖更新）
     * @param {Object} [tx] - 事务对象（可选）
     * @param {string} tableName - 业务表名
     * @param {Array} data - 业务数据（已包含 zrfcid 和 zrfc_logid）
     */
    async updateBusinessData(tx, tableName, data) {
        try {
            const BusinessEntity = cds.entities[`com.sap.zictm.${tableName}`];

            // 获取表的主键字段
            const keys = Object.keys(BusinessEntity.elements).filter(key => {
                const element = BusinessEntity.elements[key];
                return element && element.key;
            });

            if (keys.length === 0) {
                console.warn(`[updateBusinessData] 未找到业务表的主键字段: ${tableName}`);
                return;
            }

            // 逐条更新数据
            for (const item of data) {
                // 构建查询条件
                const whereConditions = {};
                for (const key of keys) {
                    if (item[key] !== undefined) {
                        whereConditions[key] = item[key];
                    }
                }

                if (Object.keys(whereConditions).length === 0) {
                    console.warn(`[updateBusinessData] 无法构建查询条件: ${tableName}`);
                    continue;
                }

                // 执行更新（使用事务或直接执行）
                await (tx ? tx.run : cds.run)(UPDATE(BusinessEntity).set(item).where(whereConditions));
            }

            console.log(`[updateBusinessData] 更新业务表成功: ${tableName}, 数据量: ${data.length}`);
        } catch (error) {
            console.error(`[updateBusinessData] 更新业务表失败: ${tableName}`, error);
            throw error;
        }
    }
}

module.exports = MultiStepProcessor;
