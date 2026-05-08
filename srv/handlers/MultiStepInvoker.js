const cds = require('@sap/cds');
const MultiStepProcessor = require('./MultiStepProcessor');
const CommonUtils = require('./CommonUtils');

class MultiStepInvoker {
    constructor() {
        this.processor = new MultiStepProcessor();
        this.commonUtils = new CommonUtils();
    }

    /**
     * 处理外围系统传输的json报文数据
     * 流程：先生成 zrfc_logid，然后插入业务表（包含 zrfcid 和 zrfc_logid），最后调用 MultiStepProcessor
     * @param {string} zrfcid - 业务流程ID
     * @param {Array} businessTable1 - 业务表1的数据
     * @param {Array} businessTable2 - 业务表2的数据（可选）
     * @param {Array} businessTable3 - 业务表3的数据（可选）
     * @param {string} zdfjy - 多方交易类型ID（可选，用于更新业务表的 zdfjy 字段）
     * @returns {Promise<Object>} 执行结果，包含zrfcid用于后续记录对账
     */
    async process(zrfcid, businessTable1, businessTable2, businessTable3, zdfjy = null) {
        const zrfcLogid = this.generateZrfcLogid();
        
        let result = {
            code: 'S',
            message: '处理成功',
            zrfcLogid,
            zrfcid
        };
        let hasSavedLog = false;
        
        try {
            // 获取业务流程配置（使用通用工具类）
            const processConfig = await this.commonUtils.getProcessConfig(zrfcid);
            if (!processConfig) {
                result.code = 'E';
                result.message = `业务流程配置不存在: ${zrfcid}`;
                await this.saveApiInputLog(zrfcLogid, { businessTable1, businessTable2, businessTable3 }, result.message);
                hasSavedLog = true;
                return result;
            }
            
            // 根据 ProcessConfig 中的 businessTable1、businessTable2、businessTable3 分别插入对应表的数据
            await this.insertBusinessDataByConfig(processConfig, businessTable1, businessTable2, businessTable3, zrfcid, zrfcLogid, zdfjy);
            
            // 构建输入数据
            const inputData = {
                zrfcLogid,
                zrfcid,
                businessTable1,
                businessTable2,
                businessTable3
            };

            // 入参处理完成，准备调用 MultiStepProcessor，ApiInputLog 记录成功
            // 步骤执行结果由 MultistepLog 负责记录，与 ApiInputLog 无关
            await this.saveApiInputLog(zrfcLogid, inputData, null);
            hasSavedLog = true;
            
            // 根据 isAsync 字段判断同步还是异步调用
            if (processConfig.isAsync) {
                this.executeAsync(zrfcid, zrfcLogid, zdfjy);
                result.message = '异步调用成功，正在处理中';
            } else {
                const processorResult = await this.processor.processWithLogId(zrfcLogid, zrfcid, null, false, zdfjy);
                result.code = processorResult.code;
                result.message = processorResult.message ? processorResult.message.substring(0, 500) : '执行成功';
                result.objkey = processorResult.objkey || '';
            }
            
        } catch (error) {
            result.code = 'E';
            const errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            result.message = `系统错误: ${errorMessage}`;
            console.error(`业务数据处理异常: ${result.message}`, error);
            
            if (!hasSavedLog) {
                await this.saveApiInputLog(zrfcLogid, { businessTable1, businessTable2, businessTable3 }, result.message);
                hasSavedLog = true;
            }
        } finally {
            // 事务由 CAP 框架自动管理
        }
        
        result.message = result.message ? result.message.substring(0, 500) : '处理成功';
            
        return result;
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
        
        let inputDataStr = JSON.stringify(inputData);
        if (inputDataStr.length > 1000) {
            inputDataStr = inputDataStr.substring(0, 1000) + '...';
        }
        
        await cds.run(
            INSERT.into(ApiInputLog).entries({
                id: zrfcLogid,
                inputData: inputDataStr,
                code: errorMessage ? 'E' : 'S',
                message: errorMessage || '入参处理成功',
                executionAt: new Date()
            })
        );
    }

    /**
     * 异步执行多步处理
     * @param {string} zrfcid - 业务流程ID
     * @param {string} zrfcLogid - 日志ID
     * @param {string} zdfjy - 多方交易类型ID
     */
    executeAsync(zrfcid, zrfcLogid, zdfjy = null) {
        setTimeout(async () => {
            try {
                await this.processor.processWithLogId(zrfcLogid, zrfcid, null, false, zdfjy);
            } catch (error) {
                console.error('异步处理异常:', error);
            }
        }, 100);
    }

    /**
     * 根据 ProcessConfig 配置分别插入 businessTable1、businessTable2、businessTable3 对应的数据表
     * @param {Object} processConfig - 业务流程配置
     * @param {Array} businessTable1Data - 业务表1的数据
     * @param {Array} businessTable2Data - 业务表2的数据
     * @param {Array} businessTable3Data - 业务表3的数据
     * @param {string} zrfcid - 业务流程ID
     * @param {string} zrfcLogid - 日志ID
     * @param {string} zdfjy - 多方交易类型ID（可选）
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
                await this.insertBusinessData(processConfig.businessTable1, table1Data);
            }

            // 处理 businessTable2
            if (processConfig.businessTable2 && businessTable2Data) {
                const table2Data = businessTable2Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.insertBusinessData(processConfig.businessTable2, table2Data);
            }

            // 处理 businessTable3
            if (processConfig.businessTable3 && businessTable3Data) {
                const table3Data = businessTable3Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.insertBusinessData(processConfig.businessTable3, table3Data);
            }
        } catch (error) {
            console.error('按配置插入业务数据失败:', error);
            throw error;
        }
    }

    /**
     * 插入业务数据表（包含 zrfcid 和 zrfc_logid 字段）
     * @param {string} tableName - 业务表名
     * @param {Array} data - 业务数据（已包含 zrfcid 和 zrfc_logid）
     */
    async insertBusinessData(tableName, data) {
        try {
            if (!tableName) {
                console.warn('业务表名为空');
                return;
            }

            // 获取业务表实体
            const BusinessEntity = cds.entities[tableName];
            if (!BusinessEntity) {
                console.warn(`业务表不存在: ${tableName}`);
                return;
            }

            // 执行批量插入（数据已包含 zrfcid 和 zrfc_logid）
            if (Array.isArray(data) && data.length > 0) {
                await cds.run(
                    INSERT.into(BusinessEntity).entries(data)
                );
            } else {
                console.warn('数据不是数组或为空');
            }
        } catch (error) {
            console.error('插入业务数据失败:', error);
            throw error;
        }
    }
}
module.exports = MultiStepInvoker;
