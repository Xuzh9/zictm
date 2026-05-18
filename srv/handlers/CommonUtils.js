const cds = require('@sap/cds');
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;

class CommonUtils {
    constructor() {
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