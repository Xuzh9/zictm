const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class ProductionOrderCreateService {
    constructor() {
        this.zrfcLogid = null;
        this.commonUtils = new CommonUtils();
    }

    async initService(zrfcLogid, zrfcid, canum) {
        this.zrfcLogid = zrfcLogid;
        this.zrfcid = zrfcid;
        this.canum = canum;
    }

    async execute(inputData) {
        try {
            const { zrfcid, canum, serviceName, readsteps, objkey, zrfcLogid, zdfjy } = inputData;
            
            this.zrfcLogid = zrfcLogid;

            // 使用通用工具类读取之前步骤的 objkey（销售订单号或采购订单号）
            let sourceDocument = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                sourceDocument = previousObjkey;
            }

            // 读取 ProcessConfig 表获取业务表名
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }

            // 读取业务表数据
            const businessDataList = await this.commonUtils.getBusinessData(businessTable, sourceDocument, 'SalesOrder');
            if (!businessDataList || businessDataList.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据，销售订单号: ${sourceDocument}`,
                    objkey: ''
                };
            }

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 获取 CSRF token（使用 OData V2 格式）
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/$metadata',
                    headers: {
                        'X-CSRF-Token': 'Fetch',
                        'Accept': 'application/json'
                    }
                }
            );

            // 提取 cookie 和 CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];

            // 为每一行业务数据创建一张独立的生产工单
            const createResults = [];
            const createdOrderNumbers = [];
            
            for (let index = 0; index < businessDataList.length; index++) {
                const businessData = businessDataList[index];
                
                // 构建生产工单创建数据（单行）
                const productionOrderData = this.buildProductionOrderData(businessData, mptStepConfig, zrfcid);
                
                console.log(`开始创建生产工单 ${index + 1}/${businessDataList.length}`);
                console.log('生产工单数据:', JSON.stringify(productionOrderData, null, 2));

                // 调用生产工单创建 API（OData V2 格式）
                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'POST',
                        url: '/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2',
                        data: productionOrderData,
                        headers: {
                            'X-CSRF-Token': csrfToken,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'Cookie': cookieString,
                            'sap-language': 'ZH'
                        },
                        validateStatus: function (status) {
                            return true;
                        }
                    }
                );

                console.log('创建生产工单位状态码:', result.status);

                if (result.status >= 200 && result.status < 300) {
                    const responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
                    const productionOrder = responseData?.d?.ProductionOrder || responseData?.ProductionOrder || '';
                    
                    console.log('生产工单创建成功:', productionOrder);
                    
                    // 将生产工单号更新到 PISalesOrderRel 表
                    await this.updatePISalesOrderRel(productionOrder, businessData);
                    
                    createResults.push({
                        success: true,
                        productionOrder: productionOrder,
                        index: index
                    });
                    createdOrderNumbers.push(productionOrder);
                } else {
                    const errorMessage = this.parseError(result.data);
                    console.error(`生产工单 ${index + 1} 创建失败:`, errorMessage);
                    createResults.push({
                        success: false,
                        errorMessage: errorMessage,
                        index: index
                    });
                }
            }

            // 检查所有工单创建结果
            const allSuccess = createResults.every(r => r.success);
            const failedCount = createResults.filter(r => !r.success).length;
            
            if (allSuccess) {
                return {
                    code: 'S',
                    message: '生产工单创建成功',
                    objkey: createdOrderNumbers[createdOrderNumbers.length - 1] || ''  // 返回最后一张工单号
                };
            } else {
                // 只返回失败的消息文本
                const failedResults = createResults.filter(r => !r.success);
                const errorMessage = failedResults.map(r => r.errorMessage).join('; ');
                console.error('生产工单创建失败:', errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: createdOrderNumbers[createdOrderNumbers.length - 1] || ''  // 返回最后成功创建的工单号
                };
            }

        } catch (error) {
            console.error('ProductionOrderCreateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '生产工单创建失败',
                objkey: ''
            };
        }
    }

    /**
     * 构建生产工单创建数据
     * @param {Object} businessData - 单行业务数据
     * @param {Object} mptStepConfig - MPTStepConfig 配置
     * @param {string} zrfcid - 业务流程ID
     * @returns {Object} 生产工单创建数据
     */
    buildProductionOrderData(businessData, mptStepConfig, zrfcid) {
        // 构建基本数据（单行）
        const productionOrderData = {
            // 生产订单类型
            OrderType: 'ZS01',
            // 工厂（从 MPTStepConfig 获取 werks）
            Plant: mptStepConfig?.werks,
            // 物料
            Material: businessData.Material,
            // 数量
            TotalQuantity: businessData.RequestedQuantity,
            // 计划开始日期
            PlannedStartDate: businessData.PlannedStartDate || new Date().toISOString().split('T')[0],
            // 计划结束日期
            PlannedEndDate: businessData.PlannedEndDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        };

        // 根据 zrfcid 添加不同的字段
        if (zrfcid === 'SD01') {
            // SD01 业务流程：添加内部交易1相关字段
            productionOrderData.YY1_FD_SO3_ORD = mptStepConfig?.PurchaseOrder1;
            productionOrderData.YY1_FD_SOITEM3_ORD = mptStepConfig?.PurchaseOrderItem1;
        } 
        // 预留其他 zrfcid 的判断条件
        // else if (zrfcid === 'PP01') {
        //     // PP01 业务流程：添加其他字段
        //     productionOrderData.XXX_FIELD = mptStepConfig?.XXX;
        // }
        // else if (zrfcid === 'MM01') {
        //     // MM01 业务流程：添加其他字段
        //     productionOrderData.YYY_FIELD = mptStepConfig?.YYY;
        // }

        return productionOrderData;
    }

    /**
     * 将生产工单号更新到 PISalesOrderRel 表
     * @param {string} productionOrder - 生产工单号
     * @param {Object} businessData - 业务数据
     */
    async updatePISalesOrderRel(productionOrder, businessData) {
        const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
        
        const piOrder = businessData.PIOrder || '';
        const piOrderItem = businessData.PIOrderItem || '';
        
        if (piOrder && piOrderItem && productionOrder) {
            try {
                await cds.run(
                    UPDATE(PISalesOrderRel)
                        .set({ ProductionOrder: productionOrder })
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                console.log(`PISalesOrderRel 更新成功: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}, ProductionOrder=${productionOrder}`);
            } catch (error) {
                console.error(`PISalesOrderRel 更新失败:`, error);
            }
        }
    }

    parseError(errorData) {
        if (!errorData) return '未知错误';
        
        if (typeof errorData === 'string') {
            try {
                errorData = JSON.parse(errorData);
            } catch (e) {
                return errorData;
            }
        }

        if (errorData?.error?.message?.value) {
            return errorData.error.message.value;
        } else if (errorData?.error?.message) {
            return errorData.error.message;
        } else if (errorData?.message) {
            return errorData.message;
        } else {
            return JSON.stringify(errorData);
        }
    }
}

module.exports = ProductionOrderCreateService;