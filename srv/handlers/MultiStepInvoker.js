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
     * @param {string} businessType - 业务类型
     * @param {Array} data - 接口传入的完整数据
     * @returns {Promise<Object>} 执行结果，包含zrfcid用于后续记录对账
     */
    async process(businessType, data) {
        // 生成 zrfcLogid
        const zrfcLogid = this.generateZrfcLogid();
        let result = {
            code: 'S',
            message: '处理成功',
            zrfcLogid
        };
        let hasSavedLog = false;
        
        try {
            // 根据业务类型查找对应的业务流程ID
            let zrfcid = null;
            let processConfig = null;
            
            // 如果业务类型为 Transfer，直接返回 MM01
            if (businessType === 'Transfer') {
                zrfcid = 'MM01';
            } else {
                // 调用 findBusinessProcessId 获取业务流程ID
                zrfcid = await this.findBusinessProcessId(businessType);
            }
            
            if (!zrfcid) {
                result.code = 'E';
                result.message = '未找到对应的业务流程ID';
                // 只保存一条错误记录
                await this.saveApiInputLog(zrfcLogid, data, result.message);
                hasSavedLog = true;
                return result;
            }
            
            // 获取业务流程配置
            processConfig = await this.getProcessConfig(zrfcid);
            if (!processConfig) {
                result.code = 'E';
                result.message = `业务流程配置不存在: ${zrfcid}`;
                // 只保存一条错误记录
                await this.saveApiInputLog(zrfcLogid, data, result.message);
                hasSavedLog = true;
                return result;
            }
            
            // 构建输入数据
            const inputData = {
                zrfcLogid,
                businessType,
                data
            };
            
            // 根据isAsync字段判断同步还是异步调用
            if (processConfig.isAsync) {
                // 异步调用
                this.executeAsync(zrfcid, zrfcLogid);
                result.message = '异步调用成功，正在处理中';
            } else {
                // 同步调用
                const processorResult = await this.processor.processWithLogId(zrfcLogid, zrfcid);
                result.code = processorResult.code;
                // 限制消息长度，避免超过系统限制
                result.message = processorResult.message ? processorResult.message.substring(0, 500) : '执行成功';
                result.objkey = processorResult.objkey || '';
            }
        
        // 只保存一条记录
        await this.saveApiInputLog(zrfcLogid, inputData, result.code === 'E' ? result.message : null);
        hasSavedLog = true;
    } catch (error) {
        // 捕获未预期的错误
        result.code = 'E';
        // 限制错误消息长度，避免超过系统限制
        const errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
        result.message = `系统错误: ${errorMessage}`;
        // 只保存一条错误记录
        if (!hasSavedLog) {
            await this.saveApiInputLog(zrfcLogid, data, result.message);
            hasSavedLog = true;
        }
    } finally {
        // 关闭数据库事务
        await this.db.commit();
    }
    
    // 限制返回消息长度，避免超过系统限制
    result.message = result.message ? result.message.substring(0, 500) : '处理成功';
        
        return result;
    }

    /**
     * 查找对应的业务流程ID
     * @param {string} businessType - 业务类型
     * @returns {Promise<string>} 业务流程ID
     */
    async findBusinessProcessId(businessType) {
        // 如果业务类型为 Transfer，则业务流程ID为 MM01
        if (businessType === 'Transfer') {
            return 'MM01';
        }
        
        // 从多方交易配置表获取
        const MPTTypeConfig = cds.entities['com.sap.zictm.MPTTypeConfig'];
        
        // 根据 zdfjy 查找
        const result = await this.db.run(
            SELECT.one.from(MPTTypeConfig).where({ zdfjy: businessType })
        );
        return result ? result.zrfcid : null;
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
        
        // 限制输入数据的 JSON 字符串长度，避免超过系统限制
        let inputDataStr = JSON.stringify(inputData);
        if (inputDataStr.length > 1000) {
            inputDataStr = inputDataStr.substring(0, 1000) + '...';
        }
        
        await this.db.run(
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
        const result = await this.db.run(
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
        // 使用setTimeout模拟异步执行
        setTimeout(async () => {
            try {
                await this.processor.processWithLogId(zrfcLogid, zrfcid);
            } catch (error) {
                console.error('Async processing error:', error);
            }
        }, 100);
    }
}

module.exports = MultiStepInvoker;