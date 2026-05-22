const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
const MultiStepProcessor = require('./MultiStepProcessor');
const CommonUtils = require('./CommonUtils');
const RetryHandler = require('./RetryHandler');

class MultiStepInvoker {
    constructor() {
        this.processor = new MultiStepProcessor();
        this.commonUtils = new CommonUtils();
        this.retryHandler = new RetryHandler();
    }

    /**
     * 处理外围系统传输的json报文数据
     * 流程：
     * 1. 判断业务表中是否已存在相同主键的记录
     * 2. 如果存在，获取现有的 zrfc_logid 执行重推
     * 3. 如果不存在，生成新的 zrfc_logid，插入业务表，然后执行处理
     * @param {string} zrfcid - 业务流程ID
     * @param {Array} businessTable1 - 业务表1的数据
     * @param {Array} businessTable2 - 业务表2的数据（可选）
     * @param {Array} businessTable3 - 业务表3的数据（可选）
     * @param {string} zdfjy - 多方交易类型ID（可选，用于更新业务表的 zdfjy 字段）
     * @param {string} id - ApiInputLog的ID，用于与MultistepHeadLog关联（可选）
     * @returns {Promise<Object>} 执行结果，包含zrfcid用于后续记录对账
     */
    async process(zrfcid, businessTable1, businessTable2, businessTable3, zdfjy = null, id = null) {
        console.log('[MultiStepInvoker.process] 开始处理, zrfcid:', zrfcid, ', zdfjy:', zdfjy, ', id:', id);
        
        let zrfcLogid = null;
        let isRetry = false;
        
        let result = {
            code: 'S',
            message: '处理成功',
            zrfcLogid,
            zrfcid
        };
        
        try {
            // 获取业务流程配置（使用通用工具类）
            console.log('[MultiStepInvoker.process] 开始获取业务流程配置');
            const processConfig = await this.commonUtils.getProcessConfig(zrfcid);
            console.log('[MultiStepInvoker.process] 业务流程配置获取成功:', JSON.stringify(processConfig));
            if (!processConfig) {
                result.code = 'E';
                result.message = `业务流程配置不存在: ${zrfcid}`;
                return result;
            }
            
            // 检查业务表中是否已存在相同主键的记录
            const existingZrfcLogid = await this.checkExistingRecord(processConfig, businessTable1);
            
            if (existingZrfcLogid) {
                // 如果存在，先更新业务表数据，然后调用 RetryHandler 执行重推
                console.log('[MultiStepInvoker.process] 发现已存在的记录，先更新业务表数据再执行重推, existingZrfcLogid:', existingZrfcLogid);
                zrfcLogid = existingZrfcLogid;
                isRetry = true;
                
                // 更新业务表数据（覆盖更新）
                await this.updateBusinessDataByConfig(processConfig, businessTable1, businessTable2, businessTable3, zrfcid, zrfcLogid, zdfjy);
                
                // 调用 RetryHandler 的 retry 方法（传递 id，因为业务数据有更新）
                const retryResult = await this.retryHandler.retry(zrfcLogid, id);
                result.code = retryResult.code;
                result.message = retryResult.message;
                result.zrfcLogid = zrfcLogid;
                return result;
            } else {
                // 如果不存在，生成新的 zrfc_logid
                zrfcLogid = this.generateZrfcLogid();
                console.log('[MultiStepInvoker.process] 生成的 zrfcLogid:', zrfcLogid);
                
                // 根据 ProcessConfig 中的 businessTable1、businessTable2、businessTable3 分别插入对应表的数据
                await this.insertBusinessDataByConfig(processConfig, businessTable1, businessTable2, businessTable3, zrfcid, zrfcLogid, zdfjy);
                
                // 根据 isAsync 字段判断同步还是异步调用
                if (processConfig.isAsync) {
                    this.executeAsync(zrfcid, zrfcLogid, zdfjy, null, false, id);
                    result.message = '异步调用成功，正在处理中';
                } else {
                    const processorResult = await this.processor.processWithLogId(zrfcLogid, zrfcid, null, false, zdfjy, id);
                    result.code = processorResult.code;
                    result.message = processorResult.message ? processorResult.message.substring(0, 500) : '执行成功';
                    result.objkey = processorResult.objkey || '';
                }
            }
            
        } catch (error) {
            result.code = 'E';
            const errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            result.message = `系统错误: ${errorMessage}`;
            console.error(`业务数据处理异常: ${result.message}`, error);
        }
        
        result.zrfcLogid = zrfcLogid;
        result.message = result.message ? result.message.substring(0, 500) : '处理成功';
            
        return result;
    }
    
    /**
     * 检查业务表中是否已存在相同主键的记录
     * @param {Object} processConfig - 业务流程配置
     * @param {Array} businessTable1Data - 业务表1的数据
     * @returns {Promise<string|null>} 已存在记录的 zrfc_logid，如果不存在则返回 null
     */
    async checkExistingRecord(processConfig, businessTable1Data) {
        try {
            if (!processConfig.businessTable1 || !businessTable1Data || !Array.isArray(businessTable1Data) || businessTable1Data.length === 0) {
                return null;
            }
            
            // 获取业务表实体
            const BusinessEntity = cds.entities[processConfig.businessTable1];
            if (!BusinessEntity) {
                console.warn(`业务表不存在: ${processConfig.businessTable1}`);
                return null;
            }
            
            // 获取表的主键字段
            const keys = Object.keys(BusinessEntity.elements).filter(key => {
                const element = BusinessEntity.elements[key];
                return element && element.key;
            });
            
            if (keys.length === 0) {
                console.warn('未找到业务表的主键字段');
                return null;
            }
            
            // 构建查询条件（使用第一条数据的主键值）
            const firstItem = businessTable1Data[0];
            const whereConditions = {};
            for (const key of keys) {
                if (firstItem[key] !== undefined) {
                    whereConditions[key] = firstItem[key];
                }
            }
            
            if (Object.keys(whereConditions).length === 0) {
                console.warn('无法构建查询条件');
                return null;
            }
            
            // 查询是否已存在记录
            const existingRecord = await cds.run(
                SELECT.one.from(BusinessEntity)
                    .columns('zrfc_logid')
                    .where(whereConditions)
            );
            
            if (existingRecord) {
                console.log(`[MultiStepInvoker.checkExistingRecord] 发现已存在记录, zrfc_logid: ${existingRecord.zrfc_logid}`);
                return existingRecord.zrfc_logid;
            }
            
            return null;
        } catch (error) {
            console.error('[MultiStepInvoker.checkExistingRecord] 检查已存在记录失败:', error);
            return null;
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
     * 异步执行多步处理
     * @param {string} zrfcid - 业务流程ID
     * @param {string} zrfcLogid - 日志ID
     * @param {string} zdfjy - 多方交易类型ID
     * @param {number} startStepNum - 起始步骤编号（用于重推）
     * @param {boolean} isRetry - 是否为重推操作
     * @param {string} id - ApiInputLog的ID，用于与MultistepHeadLog关联（可选）
     */
    executeAsync(zrfcid, zrfcLogid, zdfjy = null, startStepNum = null, isRetry = false, id = null) {
        setTimeout(async () => {
            try {
                await this.processor.processWithLogId(zrfcLogid, zrfcid, startStepNum, isRetry, zdfjy, id);
            } catch (error) {
                console.error('异步处理异常:', error);
            }
        }, 100);
    }

    /**
     * 根据 ProcessConfig 配置分别更新 businessTable1、businessTable2、businessTable3 对应的数据表（覆盖更新）
     * @param {Object} processConfig - 业务流程配置
     * @param {Array} businessTable1Data - 业务表1的数据
     * @param {Array} businessTable2Data - 业务表2的数据
     * @param {Array} businessTable3Data - 业务表3的数据
     * @param {string} zrfcid - 业务流程ID
     * @param {string} zrfcLogid - 日志ID
     * @param {string} zdfjy - 多方交易类型ID（可选）
     */
    async updateBusinessDataByConfig(processConfig, businessTable1Data, businessTable2Data, businessTable3Data, zrfcid, zrfcLogid, zdfjy = null) {
        try {
            // 处理 businessTable1
            if (processConfig.businessTable1 && businessTable1Data) {
                const table1Data = businessTable1Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.updateBusinessData(processConfig.businessTable1, table1Data);
            }

            // 处理 businessTable2
            if (processConfig.businessTable2 && businessTable2Data) {
                const table2Data = businessTable2Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.updateBusinessData(processConfig.businessTable2, table2Data);
            }

            // 处理 businessTable3
            if (processConfig.businessTable3 && businessTable3Data) {
                const table3Data = businessTable3Data.map(item => ({
                    ...item,
                    zrfcid,
                    zrfc_logid: zrfcLogid,
                    ...(zdfjy && { zdfjy })
                }));
                await this.updateBusinessData(processConfig.businessTable3, table3Data);
            }
        } catch (error) {
            console.error('按配置更新业务数据失败:', error);
            throw error;
        }
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
     * 更新业务数据表（包含 zrfcid 和 zrfc_logid 字段，覆盖更新）
     * @param {string} tableName - 业务表名
     * @param {Array} data - 业务数据（已包含 zrfcid 和 zrfc_logid）
     */
    async updateBusinessData(tableName, data) {
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

            // 获取表的主键字段
            const keys = Object.keys(BusinessEntity.elements).filter(key => {
                const element = BusinessEntity.elements[key];
                return element && element.key;
            });

            if (keys.length === 0) {
                console.warn('未找到业务表的主键字段');
                return;
            }

            // 执行批量更新（数据已包含 zrfcid 和 zrfc_logid）
            if (Array.isArray(data) && data.length > 0) {
                for (const item of data) {
                    // 构建更新条件（使用主键）
                    const whereConditions = {};
                    for (const key of keys) {
                        if (item[key] !== undefined) {
                            whereConditions[key] = item[key];
                        }
                    }

                    if (Object.keys(whereConditions).length === 0) {
                        console.warn('无法构建更新条件');
                        continue;
                    }

                    // 执行更新
                    await cds.run(
                        UPDATE(BusinessEntity)
                            .set(item)
                            .where(whereConditions)
                    );
                }
            } else {
                console.warn('数据不是数组或为空');
            }
        } catch (error) {
            console.error('更新业务数据失败:', error);
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
