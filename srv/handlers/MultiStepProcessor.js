const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

class MultiStepProcessor {
    constructor() {
        this.serviceCache = new Map();
        this.servicesDir = path.join(__dirname, '../services');
        this.db = cds.transaction();
    }

    /**
     * 处理多步流程（带日志ID）
     * @param {string} zrfcLogid - 多步执行日志ID
     * @param {string} zrfcid - 业务流程ID
     * @returns {Promise<Object>} 处理结果
     */
    async processWithLogId(zrfcLogid, zrfcid) {
        try {
            // 查询业务流程配置
            const processConfig = await this.getProcessConfig(zrfcid);
            if (!processConfig) {
                throw new Error(`业务流程配置不存在: ${zrfcid}`);
            }

            // 查询步骤配置
            const steps = await this.getSteps(zrfcid);
            if (steps.length === 0) {
                throw new Error(`业务流程无步骤配置: ${zrfcid}`);
            }

            // 按步骤编号排序
            steps.sort((a, b) => a.canum - b.canum);

            // 执行每一步
            let lastObjKey = null;
            let lastMessage = '执行成功';
            let lastCode = 'S';
            for (const step of steps) {
                // 读取入参数据
                const stepInputData = await this.readInputData(zrfcLogid, zrfcid, step);
                
                // 调用方法
                const startTime = Date.now();
                let executionResult;
                try {
                    executionResult = await this.invokeMethod(step.serviceName, stepInputData);
                } catch (error) {
                    // 限制错误消息长度，避免超过系统限制
                    const errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
                    executionResult = {
                        code: 'E',
                        message: errorMessage,
                        objkey: lastObjKey
                    };
                }
                const endTime = Date.now();
                const executionTime = (endTime - startTime) / 1000;

                // 保存日志
                // 限制消息长度，避免超过系统限制
                const logMessage = executionResult.message ? executionResult.message.substring(0, 500) : '';
                await this.saveLog(zrfcLogid, zrfcid, step.canum, {
                    ...executionResult,
                    message: logMessage
                }, executionTime);

                // 更新上一步对象号、消息和代码
                lastObjKey = executionResult.objkey || lastObjKey;
                lastMessage = executionResult.message || lastMessage;
                lastCode = executionResult.code || lastCode;
                
                // 如果当前步骤失败，停止执行后续步骤
                if (executionResult.code === 'E') {
                    break;
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
            // 保存错误日志
            // 限制错误消息长度，避免超过系统限制
            const errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            await this.saveLog(zrfcLogid, zrfcid, '0', {
                code: 'E',
                message: errorMessage
            }, 0);

            return {
                code: 'E',
                message: errorMessage,
                zrfcLogid,
                objkey: lastObjKey
            };
        } finally {
            // 关闭数据库事务
            await this.db.commit();
        }
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
     * 获取步骤配置
     * @param {string} zrfcid - 业务流程ID
     * @returns {Promise<Array>} 步骤配置列表
     */
    async getSteps(zrfcid) {
        const StepConfig = cds.entities['com.sap.zictm.StepConfig'];
        const result = await this.db.run(
            SELECT.from(StepConfig).where({ zrfcid })
        );
        return result;
    }

    /**
     * 读取入参数据
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {Object} step - 步骤配置
     * @returns {Promise<Object>} 入参数据
     */
    async readInputData(zrfcLogid, zrfcid, step) {
        let readSteps = step.readsteps;
        let objkey = null;
        
        if (!readSteps) {
            // 如果读取步骤编号为空，默认读取上一步骤的对象号
            const prevStepNum = step.canum - 10;
            readSteps = prevStepNum > 0 ? prevStepNum.toString() : null;
        }

        if (readSteps) {
            // 查询多步执行日志表，获取指定步骤的对象号
            const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
            const log = await this.db.run(
                SELECT.one.from(MultistepLog)
                    .where({ zrfc_logid: zrfcLogid, zrfcid, canum: readSteps })
            );
            if (log) {
                objkey = log.objkey;
            }
        }

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

    /**
     * 调用服务
     * @param {string} serviceName - 服务文件名
     * @param {Object} inputData - 输入数据
     * @returns {Promise<Object>} 调用结果
     */
    async invokeMethod(serviceName, inputData) {
        try {
            // 加载服务实例
            const service = await this.loadService(serviceName);
            
            // 执行服务的主要方法
            return await service.execute(inputData);
        } catch (error) {
            console.error('调用方法失败:', error);
            return {
                code: 'E',
                message: error.message,
                objkey: inputData.objkey || ''
            };
        }
    }

    /**
     * 加载服务实例
     * @param {string} serviceName - 服务名称（文件名）
     * @returns {Promise<Object>} 服务实例
     */
    async loadService(serviceName) {
        // 检查缓存
        if (this.serviceCache.has(serviceName)) {
            return this.serviceCache.get(serviceName);
        }

        // 构建服务文件路径
        const serviceFile = path.join(this.servicesDir, `${serviceName}.js`);
        
        // 检查文件是否存在
        if (!fs.existsSync(serviceFile)) {
            throw new Error(`服务文件不存在: ${serviceFile}`);
        }

        // 加载服务模块
        const ServiceClass = require(serviceFile);
        
        // 实例化服务
        const service = new ServiceClass();
        
        // 检查服务是否有execute方法
        if (!service.execute || typeof service.execute !== 'function') {
            throw new Error(`服务文件必须包含execute方法: ${serviceFile}`);
        }

        // 缓存服务实例
        this.serviceCache.set(serviceName, service);
        
        return service;
    }

    /**
     * 保存日志
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {string} canum - 步骤编号
     * @param {Object} inputData - 输入数据
     * @param {Object} executionResult - 执行结果
     * @param {number} executionTime - 执行时间
     */
    async saveLog(zrfcLogid, zrfcid, canum, executionResult, executionTime) {
        const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];
        
        // 检查日志是否已存在
        const existingLog = await this.db.run(
            SELECT.one.from(MultistepLog)
                .where({ zrfc_logid: zrfcLogid, zrfcid, canum: canum.toString() })
        );

        if (existingLog) {
            // 如果日志已存在，更新记录
            await this.db.run(
                UPDATE(MultistepLog)
                    .set({
                        code: executionResult.code,
                        message: executionResult.message,
                        objkey: executionResult.objkey,
                        executionTime,
                        modifiedAt: new Date(),
                        modifiedBy: 'SYSTEM'
                    })
                    .where({ zrfc_logid: zrfcLogid, zrfcid, canum: canum.toString() })
            );
        } else {
            // 如果日志不存在，插入新记录
            await this.db.run(
                INSERT.into(MultistepLog).entries({
                    zrfc_logid: zrfcLogid,
                    zrfcid,
                    canum: canum.toString(),
                    code: executionResult.code,
                    message: executionResult.message,
                    objkey: executionResult.objkey,
                    executionTime,
                    createdAt: new Date(),
                    createdBy: 'SYSTEM',
                    modifiedAt: new Date(),
                    modifiedBy: 'SYSTEM'
                })
            );
        }
    }
}

module.exports = MultiStepProcessor;