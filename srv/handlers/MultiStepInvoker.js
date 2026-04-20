const cds = require('@sap/cds');
const MultiStepProcessor = require('./MultiStepProcessor');

class MultiStepInvoker {
    constructor() {
        this.db = cds.transaction();
        this.processor = new MultiStepProcessor();
        this.executorService = null;
    }

    /**
     * 处理外围系统传输的json报文数据
     * @param {Object} inputData - 输入数据，包含多方交易ID或销售方&发出方信息
     * @returns {Promise<Object>} 执行结果
     */
    async process(inputData) {
        try {
            // 生成接口入参日志ID
            const logId = this.generateLogId();
            
            // 保存到接口入参日志表
            await this.saveApiInputLog(logId, inputData);
            
            // 查找对应的业务流程ID
            const zrfcid = await this.findBusinessProcessId(inputData);
            if (!zrfcid) {
                throw new Error('未找到对应的业务流程ID');
            }
            
            // 获取业务流程配置
            const processConfig = await this.getProcessConfig(zrfcid);
            if (!processConfig) {
                throw new Error(`业务流程配置不存在: ${zrfcid}`);
            }
            
            // 转换输入数据为字符串
            const inputDataStr = JSON.stringify(inputData);
            
            // 根据isAsync字段判断同步还是异步调用
            if (processConfig.isAsync) {
                // 异步调用
                this.executeAsync(zrfcid, inputDataStr);
                return {
                    code: 'S',
                    message: '异步调用成功，正在处理中',
                    logId
                };
            } else {
                // 同步调用
                const result = await this.processor.process(zrfcid, inputDataStr);
                return {
                    code: result.code,
                    message: result.message,
                    logId,
                    zrfcLogid: result.zrfcLogid
                };
            }
        } catch (error) {
            // 保存错误日志
            const logId = this.generateLogId();
            await this.saveApiInputLog(logId, inputData, error.message);
            
            return {
                code: 'E',
                message: error.message,
                logId
            };
        } finally {
            // 关闭数据库事务
            await this.db.commit();
        }
    }

    /**
     * 生成日志ID
     * @returns {string} 日志ID
     */
    generateLogId() {
        return `LOG${Date.now()}${Math.floor(Math.random() * 10000)}`;
    }

    /**
     * 保存接口入参日志
     * @param {string} logId - 日志ID
     * @param {Object} inputData - 输入数据
     * @param {string} errorMessage - 错误消息
     */
    async saveApiInputLog(logId, inputData, errorMessage = null) {
        const ProcessLog = cds.entities['com.sap.zictm.ProcessLog'];
        await this.db.run(
            INSERT.into(ProcessLog).entries({
                logid: logId,
                inputData: JSON.stringify(inputData),
                errorMessage,
                status: errorMessage ? 'E' : 'S',
                createdAt: new Date(),
                createdBy: 'SYSTEM'
            })
        );
    }

    /**
     * 查找业务流程ID
     * @param {Object} inputData - 输入数据
     * @returns {Promise<string>} 业务流程ID
     */
    async findBusinessProcessId(inputData) {
        // 首先尝试通过多方交易ID查找
        if (inputData.multiPartyTransactionId) {
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const result = await this.db.run(
                SELECT.one.from(ProcessConfig)
                    .where({ multiPartyTransactionId: inputData.multiPartyTransactionId })
            );
            if (result) {
                return result.zrfcid;
            }
        }
        
        // 然后尝试通过销售方&发出方查找
        if (inputData.seller && inputData.sender) {
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const result = await this.db.run(
                SELECT.one.from(ProcessConfig)
                    .where({ seller: inputData.seller, sender: inputData.sender })
            );
            if (result) {
                return result.zrfcid;
            }
        }
        
        return null;
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
     * @param {string} inputData - 输入数据
     */
    executeAsync(zrfcid, inputData) {
        if (!this.executorService) {
            // 初始化线程池
            const { Worker } = require('worker_threads');
            this.executorService = {
                execute: (task) => {
                    const worker = new Worker(__filename, {
                        workerData: { task, zrfcid, inputData }
                    });
                    worker.on('error', (error) => {
                        console.error('Async execution error:', error);
                    });
                    worker.on('exit', (code) => {
                        if (code !== 0) {
                            console.error(`Worker exited with code ${code}`);
                        }
                    });
                }
            };
        }

        // 提交异步任务
        this.executorService.execute(async () => {
            try {
                await this.processor.process(zrfcid, inputData);
            } catch (error) {
                console.error('Async processing error:', error);
            }
        });
    }
}

module.exports = MultiStepInvoker;