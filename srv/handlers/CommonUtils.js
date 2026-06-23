const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

class CommonUtils {
    constructor() {
    }

    /**
     * 带重试机制的 HTTP 请求（自动处理 503 错误）
     * @param {Object} destinationConfig - 目的地配置
     * @param {Object} requestConfig - 请求配置
     * @param {number} maxRetries - 最大重试次数（默认 3）
     * @param {number} retryDelay - 重试间隔毫秒（默认 1000）
     * @returns {Promise<Object>} - 请求结果
     */
    async executeHttpRequestWithRetry(destinationConfig, requestConfig, maxRetries = 3, retryDelay = 1000) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await executeHttpRequest(destinationConfig, requestConfig);
                
                // 检查是否是 503 错误
                if (result.status === 503) {
                    console.warn(`[CommonUtils.executeHttpRequestWithRetry] HTTP 503 错误，第 ${attempt} 次尝试，等待 ${retryDelay}ms 后重试...`);
                    
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        continue;
                    }
                    
                    // 最后一次尝试仍然失败
                    lastError = new Error(`HTTP 503 Service Unavailable (重试 ${maxRetries} 次后仍失败)`);
                    lastError.status = 503;
                    lastError.data = result.data;
                    throw lastError;
                }
                
                return result;
            } catch (error) {
                // 检查是否是 503 错误（可能在 catch 中捕获）
                if (error.status === 503 || error.message?.includes('503')) {
                    console.warn(`[CommonUtils.executeHttpRequestWithRetry] HTTP 503 错误，第 ${attempt} 次尝试，等待 ${retryDelay}ms 后重试...`);
                    
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        lastError = error;
                        continue;
                    }
                }
                
                // 非 503 错误直接抛出
                throw error;
            }
        }
        
        // 所有重试都失败
        throw lastError || new Error('HTTP 请求失败');
    }

    /**
     * 根据空间名称获取对应的 SAP 目标系统
     * @returns {string} 目标系统名称
     */
    getDestinationName() {
        try {
            // 从环境变量获取空间名称
            const vcapApplication = JSON.parse(process.env.VCAP_APPLICATION || '{}');
            const spaceName = vcapApplication.space_name || '';
            
            // 根据空间名称选择目标系统
            let destinationName;
            if (spaceName.toUpperCase().includes('PRD')) {
                destinationName = 'ES_API_PRD';
            } else {
                destinationName = 'ES_API';
            }
            
            // 打印空间名称和目标系统
            console.log(`[CommonUtils.getDestinationName] 空间名称: '${spaceName}', 目标系统: '${destinationName}'`);
            
            return destinationName;
        } catch (error) {
            console.warn('[CommonUtils.getDestinationName] 获取空间名称失败，使用默认目标系统:', error.message);
            return 'ES_API';
        }
    }

    /**
     * 根据 readsteps 读取之前步骤的 objkey
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {string} readsteps - 读取步骤编号
     * @param {string} currentCanum - 当前步骤编号（用于默认计算上一步骤）
     * @returns {Promise<string|null>} objkey
     */
    async getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, currentCanum) {
        let objkey = null;
        let readSteps = readsteps;
        
        if (!readSteps) {
            // 如果读取步骤编号为空，默认读取上一步骤的对象号
            const prevStepNum = parseInt(currentCanum) - 10;
            readSteps = prevStepNum > 0 ? prevStepNum.toString() : null;
        }

        if (readSteps) {
            try {
                // 查询多步执行日志表，获取指定步骤的对象号
                const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
                const log = await cds.run(
                    SELECT.one.from(MultistepLog)
                        .columns(['objkey'])
                        .where({ zrfc_logid: zrfcLogid, zrfcid, canum: readSteps })
                );
                if (log) {
                    objkey = log.objkey;
                }
            } catch (error) {
                console.error('CommonUtils.getPreviousStepObjkey 执行失败:', error);
            }
        }

        return objkey;
    }

    /**
     * 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
     * @param {string} zdfjy - 多方交易类型ID
     * @param {number} canum - 步骤编号
     * @returns {Promise<Object|null>} 配置对象
     */
    async getMPTStepConfig(zdfjy, canum) {
        
        if (!zdfjy || !canum) {
            return null;
        }
        
        try {
            const MPTStepConfig = cds.entities['com.sap.zictm.MPTStepConfig'];
            
            const config = await cds.run(
                SELECT.one.from(MPTStepConfig)
                    .where({ zdfjy, canum })
            );
            
            return config || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * 根据 zdfjy 查找 MPTTypeConfig 配置
     * @param {string} zdfjy - 多方交易类型ID
     * @returns {Promise<Object|null>} 配置对象
     */
    async getMPTTypeConfig(zdfjy) {
        if (!zdfjy) {
            return null;
        }
        
        try {
            const MPTTypeConfig = cds.entities['com.sap.zictm.MPTTypeConfig'];
            const config = await cds.run(
                SELECT.one.from(MPTTypeConfig)
                    .where({ zdfjy })
            );
            return config || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * 根据 zrfcid 查找 ProcessConfig 配置
     * @param {string} zrfcid - 业务流程ID
     * @returns {Promise<Object|null>} 配置对象
     */
    async getProcessConfig(zrfcid) {
        try {
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const config = await cds.run(
                SELECT.one.from(ProcessConfig)
                    .where({ zrfcid })
            );
            return config || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * 根据 zrfcid 获取业务表名
     * @param {string} zrfcid - 业务流程ID
     * @param {boolean} [useTable1] - 是否获取业务表1（可选）
     * @param {boolean} [useTable2] - 是否获取业务表2（可选）
     * @param {boolean} [useTable3] - 是否获取业务表3（可选）
     * @returns {Promise<string|Array|null>} 业务表名或业务表名数组
     */
    async getBusinessTableName(zrfcid, useTable1, useTable2, useTable3) {
        const config = await this.getProcessConfig(zrfcid);
        if (!config) {
            return null;
        }

        const tables = [];
        if (useTable1 === true) {
            tables.push(config.businessTable1);
        }
        if (useTable2 === true) {
            tables.push(config.businessTable2);
        }
        if (useTable3 === true) {
            tables.push(config.businessTable3);
        }

        if (tables.length === 0) {
            return config.businessTable1 || null;
        } else if (tables.length === 1) {
            return tables[0] || null;
        } else {
            return tables.filter(Boolean);
        }
    }

    /**
     * 读取业务表数据
     * @param {string} tableName - 业务表名
     * @param {string} objkey - 对象键
     * @param {string} keyField - 键字段名（默认为 SalesOrder）
     * @returns {Promise<Array>} 业务数据列表
     */
    async getBusinessData(tableName, objkey, keyField = 'SalesOrder') {
        try {
            const entity = cds.entities[`com.sap.zictm.${tableName}`];
            if (!entity) {
                console.error(`业务表不存在: ${tableName}`);
                return [];
            }

            const businessData = await cds.run(
                SELECT.from(entity)
                    .where({ [keyField]: objkey })
            );

            return businessData || [];
        } catch (error) {
            console.error('CommonUtils.getBusinessData 执行失败:', error);
            return [];
        }
    }
}

module.exports = CommonUtils;