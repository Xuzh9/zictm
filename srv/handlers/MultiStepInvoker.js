const cds = require('@sap/cds');
const MultiStepProcessor = require('./MultiStepProcessor');

class MultiStepInvoker {
    constructor() {
        this.processor = new MultiStepProcessor();
    }

    /**
     * 处理外围系统传输的json报文数据
     * 流程：先生成 zrfc_logid，然后插入业务表（包含 zrfcid 和 zrfc_logid），最后调用 MultiStepProcessor
     * @param {string} zrfcid - 业务流程ID
     * @param {Array} data - 接口传入的完整数据
     * @returns {Promise<Object>} 执行结果，包含zrfcid用于后续记录对账
     */
    async process(zrfcid, data) {
        const zrfcLogid = this.generateZrfcLogid();
        
        let result = {
            code: 'S',
            message: '处理成功',
            zrfcLogid,
            zrfcid
        };
        let hasSavedLog = false;
        
        try {
            console.log(`=== 开始处理业务数据: zrfcid=${zrfcid}, zrfcLogid=${zrfcLogid} ===`);
            
            // 获取业务流程配置
            const processConfig = await this.getProcessConfig(zrfcid);
            if (!processConfig) {
                result.code = 'E';
                result.message = `业务流程配置不存在: ${zrfcid}`;
                await this.saveApiInputLog(zrfcLogid, data, result.message);
                hasSavedLog = true;
                return result;
            }
            
            // 将 zrfcid 和 zrfc_logid 添加到每条业务数据中
            console.log(`=== 将 zrfcid 和 zrfc_logid 添加到业务数据中 ===`);
            const dataWithLogIds = data.map(item => ({
                ...item,
                zrfcid,
                zrfc_logid: zrfcLogid
            }));
            
            // 插入业务表（根据 zrfcid 确定表名）
            console.log(`=== 插入业务表: zrfcid=${zrfcid} ===`);
            await this.insertBusinessData(zrfcid, dataWithLogIds);
            
            // 构建输入数据
            const inputData = {
                zrfcLogid,
                zrfcid,
                data: dataWithLogIds
            };
            
            // 根据 isAsync 字段判断同步还是异步调用
            if (processConfig.isAsync) {
                console.log(`=== 异步调用 MultiStepProcessor: zrfcid=${zrfcid}, zrfcLogid=${zrfcLogid} ===`);
                this.executeAsync(zrfcid, zrfcLogid);
                result.message = '异步调用成功，正在处理中';
            } else {
                console.log(`=== 同步调用 MultiStepProcessor: zrfcid=${zrfcid}, zrfcLogid=${zrfcLogid} ===`);
                const processorResult = await this.processor.processWithLogId(zrfcLogid, zrfcid);
                result.code = processorResult.code;
                result.message = processorResult.message ? processorResult.message.substring(0, 500) : '执行成功';
                result.objkey = processorResult.objkey || '';
            }
        
            // 保存接口入参日志（只保存一条记录）
            await this.saveApiInputLog(zrfcLogid, inputData, result.code === 'E' ? result.message : null);
            hasSavedLog = true;
            console.log(`=== 业务数据处理完成: code=${result.code}, message=${result.message} ===`);
            
        } catch (error) {
            result.code = 'E';
            const errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            result.message = `系统错误: ${errorMessage}`;
            console.error(`=== 业务数据处理异常: ${result.message} ===`, error);
            
            if (!hasSavedLog) {
                await this.saveApiInputLog(zrfcLogid, data, result.message);
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
                zrfc_logid: zrfcLogid,
                inputData: inputDataStr,
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
        const result = await cds.run(
            SELECT.one.from(ProcessConfig).where({ zrfcid })
        );
        return result;
    }

    /**
     * 异步执行多步处理
     * @param {string} zrfcid - 业务流程ID
     * @param {string} zrfcLogid - 日志ID
     */
    executeAsync(zrfcid, zrfcLogid) {
        setTimeout(async () => {
            try {
                await this.processor.processWithLogId(zrfcLogid, zrfcid);
            } catch (error) {
                console.error('Async processing error:', error);
            }
        }, 100);
    }

    /**
     * 插入业务数据表（包含 zrfcid 和 zrfc_logid 字段）
     * @param {string} zrfcid - 业务流程ID
     * @param {Array} data - 业务数据（已包含 zrfcid 和 zrfc_logid）
     */
    async insertBusinessData(zrfcid, data) {
        try {
            // 根据 zrfcid 确定业务表名
            const tableName = this.getTableNameByZrfcid(zrfcid);
            if (!tableName) {
                console.warn(`未配置的业务流程ID: ${zrfcid}`);
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
                const insertResult = await cds.run(
                    INSERT.into(BusinessEntity).entries(data)
                );
                console.log(`插入业务表成功: ${tableName}, 记录数: ${data.length}`, insertResult);
            } else {
                console.warn('数据不是数组或为空:', data);
            }
        } catch (error) {
            console.error('插入业务数据失败:', error);
            throw error;
        }
    }

    /**
     * 根据 zrfcid 获取对应的业务表名
     * @param {string} zrfcid - 业务流程ID
     * @returns {string|null} 业务表名
     */
    getTableNameByZrfcid(zrfcid) {
        // 根据 zrfcid 确定业务表名
        // MM01 -> Transfer
        // 其他 zrfcid 可以后续添加
        switch (zrfcid) {
            case 'MM01':
                return 'Transfer';
            // 其他业务流程ID对应的表可以后续添加
            // case 'XX01':
            //     return 'OtherTable';
            default:
                console.warn(`未配置的业务流程ID: ${zrfcid}`);
                return null;
        }
    }
}

module.exports = MultiStepInvoker;