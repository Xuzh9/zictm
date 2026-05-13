const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class ProductionOrderUpdateService {
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

            // 读取 ProcessConfig 表获取业务表名（使用业务表1）
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid, true);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }

            // 读取业务表数据（使用 zrfc_logid 查询）
            const businessDataList = await this.commonUtils.getBusinessData(businessTable, zrfcLogid, 'zrfc_logid');
            if (!businessDataList || businessDataList.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据`,
                    objkey: ''
                };
            }

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 从 PISalesOrderRel 表获取所有生产工单号映射
            const poMapping = await this.getProductionOrderMapping(businessDataList);

            if (poMapping.length === 0) {
                console.log('所有业务数据都没有找到对应的生产工单，步骤跳过');
                return {
                    code: 'S',
                    message: '所有业务数据都没有找到对应的生产工单，步骤跳过',
                    objkey: ''
                };
            }

            // 获取第一个生产工单号用于后续返回
            const firstProductionOrder = poMapping[0].productionOrder;
            
            // 循环修改每个生产工单
            const updateResults = [];
            for (const mapping of poMapping) {
                const { productionOrder, businessData } = mapping;
                
                // 构建生产工单修改数据
                const updateData = this.buildUpdateData(businessData, mptStepConfig);
                
                // 如果没有需要更新的字段，跳过该工单
                if (Object.keys(updateData).length === 0) {
                    console.log(`生产工单 ${productionOrder} 没有需要更新的字段，跳过`);
                    continue;
                }
                
                // 获取 CSRF token 和 ETag（为每个工单单独获取）
                const csrfResult = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'GET',
                        url: `/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2('${productionOrder}')`,
                        headers: {
                            'X-CSRF-Token': 'Fetch'
                        }
                    }
                );
                
                const cookies = csrfResult.headers['set-cookie'] || [];
                const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
                const csrfToken = csrfResult.headers['x-csrf-token'];
                const etag = csrfResult.headers['etag'] || csrfResult.headers['ETag'];
                
                console.log(`开始修改生产工单: ${productionOrder}`);
                console.log('修改数据:', JSON.stringify(updateData, null, 2));

                // 调用生产工单修改 API（OData V2 格式，使用 PATCH）
                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'PATCH',
                        url: `/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2('${productionOrder}')`,
                        data: updateData,
                        headers: {
                            'X-CSRF-Token': csrfToken,
                            'Content-Type': 'application/json',
                            'Cookie': cookieString,
                            'sap-language': 'ZH',
                            'If-Match': etag || '*'
                        },
                        validateStatus: function (status) {
                            return true;
                        }
                    }
                );

                // 解析SAP返回的错误信息
                let errorMessage = '';
                if (result.status >= 400 && result.data) {
                    // 处理JSON格式错误
                    if (result.data?.error) {
                        errorMessage = result.data.error.message?.value || result.data.error.message || JSON.stringify(result.data.error);
                    }
                    // 处理XML格式错误（SAP API可能返回XML）
                    else if (typeof result.data === 'string' && result.data.startsWith('<?xml')) {
                        const messageMatch = result.data.match(/<message[^>]*>([^<]+)<\/message>/);
                        errorMessage = messageMatch ? messageMatch[1] : 'XML格式错误';
                    }
                    else {
                        errorMessage = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
                    }
                }
                
                // 打印详细错误信息
                if (!(result.status >= 200 && result.status < 300)) {
                    console.error(`生产工单修改失败: ${productionOrder}, 状态码: ${result.status}, 错误信息: ${errorMessage}`);
                }
                
                updateResults.push({
                    productionOrder: productionOrder,
                    status: result.status,
                    success: result.status >= 200 && result.status < 300,
                    error: result.status >= 400,
                    message: errorMessage
                });
            }

            // 检查所有工单修改结果
            // 如果没有任何工单需要更新，返回跳过状态
            if (updateResults.length === 0) {
                console.log('所有生产工单都没有需要更新的字段，步骤跳过');
                return {
                    code: 'S',
                    message: '所有生产工单都没有需要更新的字段，步骤跳过',
                    objkey: firstProductionOrder
                };
            }

            const allSuccess = updateResults.every(r => r.success);
            const failedOrders = updateResults.filter(r => !r.success);
            
            if (allSuccess) {
                console.log('所有生产工单修改成功');
                return {
                    code: 'S',
                    message: '生产工单修改成功',
                    objkey: firstProductionOrder
                };
            } else {
                // 构建包含详细错误信息的消息
                const errorDetails = failedOrders.map(i => {
                    if (i.message) {
                        return `${i.productionOrder} (${i.message})`;
                    }
                    return `${i.productionOrder} (状态码: ${i.status})`;
                });
                const errorMessage = `生产工单修改失败: ${errorDetails.join(', ')}`;
                console.error(errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('ProductionOrderUpdateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '生产工单修改失败',
                objkey: ''
            };
        }
    }

    async getProductionOrderMapping(businessDataList) {
        const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
        const mappings = [];
        
        for (const businessData of businessDataList) {
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = businessData.PIOrderItem || '';
            
            if (piOrder && piOrderItem) {
                const record = await cds.run(
                    SELECT.one.from(PISalesOrderRel)
                        .columns(['ProductionOrder'])
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                if (record && record.ProductionOrder) {
                    mappings.push({
                        piOrder: piOrder,
                        piOrderItem: piOrderItem,
                        productionOrder: record.ProductionOrder,
                        businessData: businessData
                    });
                } else {
                    console.warn(`未找到 PISalesOrderRel 记录或缺少生产工单信息: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}`);
                }
            }
        }
        
        return mappings;
    }

    buildUpdateData(businessData, mptStepConfig) {
        const updateData = {};

        // 只有当字段有值时才添加到更新对象中
        if (businessData.RequestedDeliveryDate) {
            updateData.YY1_FD_REQDATE_ORD = this.formatDateForSAP(businessData.RequestedDeliveryDate);
        }
        if (businessData.RequestedQuantity) {
            updateData.TotalQuantity = businessData.RequestedQuantity;
        }
        if (businessData.ConfirmedDeliveryDate) {
            updateData.MfgOrderPlannedStartDate = this.formatDateForSAP(businessData.ConfirmedDeliveryDate);
            updateData.MfgOrderPlannedEndDate = this.formatDateForSAP(businessData.ConfirmedDeliveryDate);
        }
        if (businessData.Material) {
            updateData.Material = businessData.Material;
        }        
        return updateData;
    }

    formatDateForSAP(dateString) {
        if (!dateString) return '';
        
        const date = new Date(dateString);
        const timestamp = date.getTime();
        return `/Date(${timestamp})/`;
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
        }
        
        return JSON.stringify(errorData);
    }
}

module.exports = ProductionOrderUpdateService;