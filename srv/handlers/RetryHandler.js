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
     * @param {string} id - ApiInputLog的ID（可选，当业务数据更新时传入新的id）
     * @param {string} zdfjy - 多方交易类型ID（可选，前端点击重推时不传，由系统从MultistepHeadLog获取）
     * @returns {Promise<Object>} 执行结果
     */
    async retry(zrfcLogid, id = null, zdfjy = null) {
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
            console.log('[RetryHandler.retry] 开始重推, zrfcLogid:', zrfcLogid, ', id:', id, ', zdfjy:', zdfjy);
            
            // 查询多步执行日志，找到失败的步骤
            const failedSteps = await this.getFailedSteps(zrfcLogid);
            console.log('[RetryHandler.retry] 失败步骤数:', failedSteps.length);
            
            if (failedSteps.length === 0) {
                // 没有失败步骤：可能是头表残留为 E 但所有步骤均已成功（如执行中断导致头表未更新为 S）
                // 校验所有配置步骤是否都已有成功日志，若是则直接修正头表为 S 并返回成功
                const allStepsCheck = await this.checkAllStepsSucceeded(zrfcLogid);
                if (allStepsCheck.allSucceeded) {
                    console.log('[RetryHandler.retry] 所有步骤均已成功，直接修正头表为 S, zrfcLogid:', zrfcLogid);
                    await this.markHeadLogSucceeded(zrfcLogid, allStepsCheck.zrfcid, id, allStepsCheck.lastMessage);
                    return {
                        code: 'S',
                        message: '所有步骤均已成功，无需重推',
                        zrfcLogid
                    };
                }
                // 没有失败步骤，返回错误（包含日志ID）
                throw new Error(`日志ID${zrfcLogid}没有失败的步骤，无法重推`);
            }

            // 找到最早的失败步骤
            const firstFailedStep = failedSteps.sort((a, b) => parseInt(a.canum) - parseInt(b.canum))[0];
            const zrfcid = firstFailedStep.zrfcid;
            const failedStepNum = parseInt(firstFailedStep.canum);
            
            // 查询 ProcessConfig 获取 isAsync 配置和业务表名
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const processConfig = await cds.run(
                SELECT.one.from(ProcessConfig).where({ zrfcid: zrfcid })
            );
            const isAsync = processConfig?.isAsync || false;
            const businessTable1 = processConfig?.businessTable1;
            
            // 如果没有传入 zdfjy，依次从 MultistepHeadLog、业务表获取
            if (!zdfjy) {
                // 1. 优先从 MultistepHeadLog 获取（前端点击重推时使用）
                const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
                const headLog = await cds.run(
                    SELECT.one.from(MultistepHeadLog).where({ zrfc_logid: zrfcLogid })
                );
                if (headLog?.zdfjy) {
                    zdfjy = headLog.zdfjy;
                    console.log('[RetryHandler.retry] 从 MultistepHeadLog 获取 zdfjy:', zdfjy);
                }
                
                // 2. 如果还是没有找到，从业务表获取
                if (!zdfjy && businessTable1) {
                    try {
                        const BusinessTable = cds.entities[`com.sap.zictm.${businessTable1}`];
                        if (BusinessTable) {
                            const businessData = await cds.run(
                                SELECT.one.from(BusinessTable).where({ zrfc_logid: zrfcLogid })
                            );
                            if (businessData && businessData.zdfjy) {
                                zdfjy = businessData.zdfjy;
                                console.log('[RetryHandler.retry] 从业务表', businessTable1, '获取 zdfjy:', zdfjy);
                            }
                        }
                    } catch (error) {
                        console.warn('[RetryHandler.retry] 从业务表获取 zdfjy 失败:', error.message);
                    }
                }
            }
            
            console.log('[RetryHandler.retry] 重推配置, zrfcid:', zrfcid, 'failedStepNum:', failedStepNum, 'zdfjy:', zdfjy, 'isAsync:', isAsync);

            let result;
            if (isAsync) {
                // 异步执行重推
                console.log('[RetryHandler.retry] 开始异步重推');
                this.executeAsync(zrfcLogid, zrfcid, failedStepNum, zdfjy, id, processConfig);
                result = {
                    code: 'S',
                    message: '重推请求已提交，正在异步处理中',
                    zrfcLogid
                };
            } else {
                // 同步执行重推（传递 zdfjy、id 和 processConfig）
                console.log('[RetryHandler.retry] 开始同步重推');
                result = await this.processor.processWithLogId(zrfcLogid, zrfcid, failedStepNum, true, zdfjy, id, processConfig, null, null, null, true);
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
     * @param {string} id - ApiInputLog的ID（可选）
     * @param {Object} processConfig - 业务流程配置（可选）
     */
    executeAsync(zrfcLogid, zrfcid, failedStepNum, zdfjy, id = null, processConfig = null) {
        setTimeout(async () => {
            try {
                await this.processor.processWithLogId(zrfcLogid, zrfcid, failedStepNum, true, zdfjy, id, processConfig, null, null, null, true);
            } catch (error) {
                console.error('异步重推处理异常:', error);
                // 确保异步重推失败时也能保存日志
                // 先尝试获取第一个步骤号，用于保存错误日志
                let firstStepCanum = '0';
                try {
                    const cds = require('@sap/cds');
                    const { SELECT } = cds.ql;
                    const StepConfig = cds.entities['com.sap.zictm.StepConfig'];
                    const steps = await cds.run(
                        SELECT.from(StepConfig)
                            .where({ process_zrfcid: zrfcid })
                            .orderBy('canum')
                            .limit(1)
                    );
                    if (steps && steps.length > 0) {
                        firstStepCanum = String(steps[0].canum);
                    }
                } catch (e) {
                    console.warn('[RetryHandler.executeAsync] 获取步骤配置失败，使用默认canum: 0');
                }
                try {
                    const cds = require('@sap/cds');
                    const { INSERT, SELECT } = cds.ql;
                    const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
                    // 先检查是否已有错误日志（由 processWithLogId 保存）
                    const existingLog = await cds.run(
                        SELECT.one.from(MultistepLog)
                            .where({ zrfc_logid: zrfcLogid, canum: firstStepCanum })
                    );
                    if (!existingLog) {
                        await cds.tx(async (tx) => {
                            await tx.run(
                                INSERT.into(MultistepLog).entries({
                                    zrfc_logid: zrfcLogid,
                                    canum: firstStepCanum,
                                    zrfcid: zrfcid,
                                    code: 'E',
                                    message: error.message ? error.message.substring(0, 500) : '异步重推处理异常',
                                    executionAt: new Date(),
                                    lastExecutionAt: new Date()
                                })
                            );
                        });
                        console.log(`[RetryHandler.executeAsync] 异步重推失败日志保存成功, zrfcLogid: ${zrfcLogid}, canum: ${firstStepCanum}`);
                    } else {
                        console.log(`[RetryHandler.executeAsync] 步骤 ${firstStepCanum} 已有错误日志，跳过重复保存`);
                    }
                } catch (logError) {
                    console.error(`[RetryHandler.executeAsync] 保存失败日志失败: ${logError.message}`);
                }
                // 更新 MultistepHeadLog 标记为失败
                try {
                    await this.processor.saveHeadLog(null, zrfcLogid, zrfcid, zdfjy, id, 'E', error.message ? error.message.substring(0, 500) : '异步重推处理异常', new Date());
                } catch (headLogError) {
                    console.error(`[RetryHandler.executeAsync] 更新HeadLog失败: ${headLogError.message}`);
                }
            }
        }, 100);
    }

    /**
     * 获取失败的步骤
     * 包括：状态为 E、P、空或空字符串的步骤；以及配置中存在但没有任何日志的步骤（从未执行，如流程中断）
     * @param {string} zrfcLogid - 多步ID
     * @returns {Promise<Array>} 失败步骤列表
     */
    async getFailedSteps(zrfcLogid) {
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];

        const allSteps = await cds.run(
            SELECT.from(MultistepLog).where({ zrfc_logid: zrfcLogid })
        );
        console.log('[RetryHandler.getFailedSteps] 所有步骤:', JSON.stringify(allSteps));

        // 状态为 E、P 或空的步骤（均可重推）
        const failedSteps = (allSteps || []).filter(s => ['E', 'P', null, ''].includes(s.code));

        // 补充：配置中存在但没有日志的步骤（从未执行），也视为失败步骤
        if (allSteps && allSteps.length > 0) {
            const zrfcid = allSteps[0].zrfcid;
            const configuredSteps = await this.getSteps(zrfcid);
            const loggedCanums = new Set(allSteps.map(s => String(s.canum)));
            for (const step of configuredSteps || []) {
                if (!loggedCanums.has(String(step.canum))) {
                    console.log('[RetryHandler.getFailedSteps] 步骤', step.canum, '无日志（从未执行），加入重推范围');
                    failedSteps.push({
                        canum: step.canum,
                        zrfcid: step.zrfcid,
                        code: null,
                        description: step.description
                    });
                }
            }
        }

        return failedSteps;
    }

    /**
     * 校验该多步ID下所有配置步骤是否都已有成功日志
     * 必须比对 StepConfig 中配置的全部步骤，防止"部分步骤从未执行"被误判为成功
     * @param {string} zrfcLogid - 多步ID
     * @returns {Promise<Object>} { allSucceeded, zrfcid, lastMessage }
     */
    async checkAllStepsSucceeded(zrfcLogid) {
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
        const logs = await cds.run(
            SELECT.from(MultistepLog).where({ zrfc_logid: zrfcLogid })
        );
        if (!logs || logs.length === 0) {
            return { allSucceeded: false };
        }

        const zrfcid = logs[0].zrfcid;
        const steps = await this.getSteps(zrfcid);
        if (!steps || steps.length === 0) {
            return { allSucceeded: false };
        }

        const logMap = {};
        for (const log of logs) {
            logMap[String(log.canum)] = log;
        }

        const allSucceeded = steps.every(step => {
            const log = logMap[String(step.canum)];
            return log && (log.code === 'S' || log.code === 's');
        });

        // 取最后一步的消息，用于修正头表（与正常成功收尾口径一致）
        let lastMessage = '';
        if (allSucceeded) {
            const sortedSteps = [...steps].sort((a, b) => parseInt(a.canum) - parseInt(b.canum));
            const lastLog = logMap[String(sortedSteps[sortedSteps.length - 1].canum)];
            lastMessage = lastLog?.message || '';
        }

        return { allSucceeded, zrfcid, lastMessage };
    }

    /**
     * 修正头表为成功状态（用于步骤全S但头表残留E的场景）
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {string} id - ApiInputLog 的 ID（可选，有值则同步）
     * @param {string} lastMessage - 最后一步的消息
     */
    async markHeadLogSucceeded(zrfcLogid, zrfcid, id, lastMessage) {
        const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
        const updateData = {
            code: 'S',
            message: lastMessage || '处理成功',
            lastExecutionAt: new Date()
        };
        if (id) {
            updateData.id = id;
        }
        await cds.run(
            UPDATE(MultistepHeadLog)
                .set(updateData)
                .where({ zrfc_logid: zrfcLogid })
        );
        console.log('[RetryHandler.markHeadLogSucceeded] 头表已修正为 S, zrfcLogid:', zrfcLogid);
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
