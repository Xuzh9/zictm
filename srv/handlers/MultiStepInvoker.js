const cds = require('@sap/cds');
const MultiStepProcessor = require('./MultiStepProcessor');

class MultiStepInvoker {
    constructor() {
        this.db = cds.transaction();
        this.processor = new MultiStepProcessor();
    }

    /**
     * 处理外围系统传输的json报文数据
     * 统一生成zrfcid并保存到ApiInputLog
     * @param {string} businessId - 业务ID（如调拨单ID、出库单ID等）
     * @returns {Promise<Object>} 执行结果，包含zrfcid用于后续记录对账
     */
    async process(businessId) {
        const zrfcLogid = this.generateZrfcLogid();
        const errorMessages = [];
        let result = {
            code: 'S',
            message: '处理成功',
            zrfcLogid
        };
        
        try {
            // 保存初始日志
            await this.saveApiInputLog(zrfcLogid, { businessId });
            
            // 查找对应的业务流程ID（从多方交易配置表获取）
            const businessProcessId = await this.findBusinessProcessId(businessId);
            if (!businessProcessId) {
                errorMessages.push('未找到对应的业务流程ID');
            } else {
                // 获取业务流程配置
                const processConfig = await this.getProcessConfig(businessProcessId);
                if (!processConfig) {
                    errorMessages.push(`业务流程配置不存在: ${businessProcessId}`);
                } else {
                    // 读取对应业务表的数据
                    const businessData = await this.readBusinessData(processConfig, businessId);
                    if (!businessData) {
                        errorMessages.push(`未找到业务数据: ${businessId}`);
                    } else {
                        // 更新业务表的 zrfcid 和 zrfc_logid 字段
                        // zrfcid: 从多方交易配置表获取，每次都更新
                        // zrfc_logid: 生成的UUID，仅在为空时更新（不覆盖已有值）
                        await this.updateBusinessData(processConfig, businessId, businessProcessId, zrfcLogid);
                        
                        // 构建输入数据
                        const inputData = {
                            zrfcLogid,
                            businessId,
                            businessData
                        };
                        
                        // 保存更新后的输入数据到接口入参日志表
                        await this.saveApiInputLog(zrfcLogid, inputData);
                        
                        // 根据业务数据中的zrfcid获取业务流程配置
                        const actualBusinessProcessId = businessData.zrfcid || businessProcessId;
                        
                        // 转换输入数据为字符串
                        const inputDataStr = JSON.stringify(inputData);
                        
                        // 根据isAsync字段判断同步还是异步调用
                        if (processConfig.isAsync) {
                            // 异步调用
                            this.executeAsync(actualBusinessProcessId, zrfcLogid, inputDataStr);
                            result.message = '异步调用成功，正在处理中';
                        } else {
                            // 同步调用
                            const processorResult = await this.processor.processWithLogId(zrfcLogid, actualBusinessProcessId, inputDataStr);
                            result.code = processorResult.code;
                            result.message = processorResult.message;
                        }
                    }
                }
            }
            
            // 处理错误信息
            if (errorMessages.length > 0) {
                const errorMessage = errorMessages.join('; ');
                result.code = 'E';
                result.message = errorMessage;
                // 保存错误日志
                await this.saveApiInputLog(zrfcLogid, { businessId }, errorMessage);
            }
        } catch (error) {
            // 捕获未预期的错误
            const errorMessage = `系统错误: ${error.message}`;
            result.code = 'E';
            result.message = errorMessage;
            // 保存错误日志
            await this.saveApiInputLog(zrfcLogid, { businessId }, errorMessage);
        } finally {
            // 关闭数据库事务
            await this.db.commit();
        }
        
        return result;
    }

    /**
     * 查找对应的业务流程ID
     * @param {string} businessId - 业务ID
     * @returns {Promise<string>} 业务流程ID
     */
    async findBusinessProcessId(businessId) {
        // 这里简化处理，实际应根据业务逻辑查询
        // 例如：从业务表中查询zrfcid字段
        return 'ZRFC001'; // 示例返回
    }

    /**
     * 读取对应业务表的数据
     * @param {Object} processConfig - 业务流程配置
     * @param {string} businessId - 业务ID
     * @returns {Promise<Object>} 业务数据
     */
    async readBusinessData(processConfig, businessId) {
        try {
            // 尝试从三个业务表中读取数据
            const businessTables = [
                processConfig.businessTable1,
                processConfig.businessTable2,
                processConfig.businessTable3
            ].filter(Boolean); // 过滤空值
            
            for (const businessTable of businessTables) {
                // 根据业务表名动态获取实体
                const Entity = cds.entities[`com.sap.zictm.${businessTable}`];
                if (!Entity) {
                    console.warn(`业务表不存在: ${businessTable}`);
                    continue;
                }
                
                // 查询业务数据
                // 假设主键字段名为${businessTable}（如TransferOrder表的主键为TransferOrder）
                const result = await this.db.run(
                    SELECT.one.from(Entity)
                        .where({ [businessTable]: businessId })
                );
                
                if (result) {
                    return {
                        ...result,
                        _businessTable: businessTable // 添加业务表名到返回数据中
                    };
                }
            }
            
            return null; // 所有表都未找到数据
        } catch (error) {
            console.error(`读取业务数据失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 更新业务表的 zrfcid 和 zrfc_logid 字段（仅在为空时更新，不覆盖已有值）
     * @param {Object} processConfig - 业务流程配置
     * @param {string} businessId - 业务ID
     * @param {string} zrfcid - 业务流程ID（从多方交易配置表获取）
     * @param {string} zrfcLogid - 日志ID（生成的UUID）
     */
    async updateBusinessData(processConfig, businessId, zrfcid, zrfcLogid) {
        try {
            const businessTables = [
                processConfig.businessTable1,
                processConfig.businessTable2,
                processConfig.businessTable3
            ].filter(Boolean);

            for (const businessTable of businessTables) {
                const Entity = cds.entities[`com.sap.zictm.${businessTable}`];
                if (!Entity) {
                    continue;
                }

                // 查询业务数据
                const result = await this.db.run(
                    SELECT.one.from(Entity)
                        .where({ [businessTable]: businessId })
                );

                if (result) {
                    const updateData = {};
                    let hasUpdate = false;

                    // 仅在 zrfcid 为空时才更新
                    if (!result.zrfcid) {
                        updateData.zrfcid = zrfcid;
                        hasUpdate = true;
                    }
                    // 仅在 zrfc_logid 为空时才更新
                    if (!result.zrfc_logid) {
                        updateData.zrfc_logid = zrfcLogid;
                        hasUpdate = true;
                    }

                    if (hasUpdate) {
                        await this.db.run(
                            UPDATE(Entity)
                                .set(updateData)
                                .where({ [businessTable]: businessId })
                        );
                        console.log(`更新业务表 ${businessTable}: zrfcid=${zrfcid}, zrfc_logid=${zrfcLogid}`);
                    } else {
                        console.log(`业务表 ${businessTable} 已有 zrfcid 和 zrfc_logid，不再更新`);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`更新业务表字段失败: ${error.message}`);
        }
    }

    /**
     * 生成日志ID (zrfcLogid)
     * @returns {string} UUID格式的日志ID
     */
    generateZrfcLogid() {
        return cds.utils.uuid();
    }

    /**
     * 保存接口入参日志
     * @param {string} zrfcLogid - 日志ID
     * @param {Object} inputData - 输入数据
     * @param {string} errorMessage - 错误消息
     */
    async saveApiInputLog(zrfcLogid, inputData, errorMessage = null) {
        const ApiInputLog = cds.entities['com.sap.zictm.ApiInputLog'];
        await this.db.run(
            INSERT.into(ApiInputLog).entries({
                zrfc_logid: zrfcLogid,
                inputData: JSON.stringify(inputData),
                code: errorMessage ? 'E' : 'S',
                message: errorMessage || '处理成功'
            })
        );
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
     * 异步执行多步处理
     * @param {string} businessProcessId - 业务流程ID
     * @param {string} zrfcLogid - 日志ID
     * @param {string} inputData - 输入数据
     */
    executeAsync(businessProcessId, zrfcLogid, inputData) {
        // 使用setTimeout模拟异步执行
        setTimeout(async () => {
            try {
                await this.processor.processWithLogId(zrfcLogid, businessProcessId, inputData);
            } catch (error) {
                console.error('Async processing error:', error);
            }
        }, 100);
    }
}

module.exports = MultiStepInvoker;