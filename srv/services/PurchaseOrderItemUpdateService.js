const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class PurchaseOrderItemUpdateService {
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

            // 从 PISalesOrderRel 表获取采购订单和行项目号映射
            const poMapping = await this.getPOMappingFromPISalesOrderRel(businessDataList);

            // 如果没有有效的映射结果，返回跳过状态
            if (poMapping.length === 0) {
                const step = parseInt(canum);
                let message = 'PISalesOrderRel 中 PurchaseOrder1 为空，步骤跳过';
                
                return {
                    code: 'S',
                    message: message,
                    objkey: ''
                };
            }

            // 逐条修改行项目
            const updateResults = [];
            for (const mapping of poMapping) {
                const { purchaseOrder, purchaseOrderItem, businessData } = mapping;
                
                // 构建行项目修改数据
                const itemData = this.buildItemData(businessData, mptStepConfig);
                
                // 如果没有需要更新的字段，跳过该行项目
                if (Object.keys(itemData).length === 0) {
                    console.log(`采购订单行项目 ${purchaseOrder} - ${purchaseOrderItem} 没有需要更新的字段，跳过`);
                    continue;
                }
                
                // 获取 CSRF token 和当前数据（包括 DocumentCurrency）
                const csrfResult = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'GET',
                        url: `/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrderItem/${purchaseOrder}/${purchaseOrderItem}`,
                        headers: {
                            'X-CSRF-Token': 'Fetch'
                        }
                    }
                );

                // 提取 cookie、CSRF token 和 ETag
                const cookies = csrfResult.headers['set-cookie'] || [];
                const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
                const csrfToken = csrfResult.headers['x-csrf-token'];
                const etag = csrfResult.headers['etag'] || csrfResult.headers['ETag'];
                
                // 从GET响应中获取字段（用于更新时需要的关联字段）
                const documentCurrency = csrfResult.data?.DocumentCurrency;
                const purchaseOrderQuantityUnit = csrfResult.data?.PurchaseOrderQuantityUnit;
                
                // 如果更新NetPriceAmount，必须同时提供DocumentCurrency
                if (itemData.NetPriceAmount && documentCurrency) {
                    itemData.DocumentCurrency = documentCurrency;
                }
                
                // 如果更新OrderQuantity，必须同时提供PurchaseOrderQuantityUnit
                if (itemData.OrderQuantity && purchaseOrderQuantityUnit) {
                    itemData.PurchaseOrderQuantityUnit = purchaseOrderQuantityUnit;
                }
                
                console.log(`开始修改采购订单行项目: ${purchaseOrder} - ${purchaseOrderItem}`);
                console.log('修改数据:', JSON.stringify(itemData, null, 2));

                // 调用采购订单行项目修改 API
                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'PATCH',
                        url: `/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrderItem/${purchaseOrder}/${purchaseOrderItem}`,
                        data: itemData,
                        headers: {
                            'X-CSRF-Token': csrfToken,
                            'Content-Type': 'application/json;charset=UTF-8',
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
                if (result.status >= 400 && result.data?.error) {
                    errorMessage = result.data.error.message?.value || result.data.error.message || JSON.stringify(result.data.error);
                }

                updateResults.push({
                    purchaseOrder: purchaseOrder,
                    purchaseOrderItem: purchaseOrderItem,
                    status: result.status,
                    success: result.status >= 200 && result.status < 300,
                    errorMessage: errorMessage
                });
            }

            // 检查所有行项目修改结果
            // 如果没有任何行项目需要更新，返回跳过状态
            if (updateResults.length === 0) {
                console.log('所有采购订单行项目都没有需要更新的字段，步骤跳过');
                return {
                    code: 'S',
                    message: '所有采购订单行项目都没有需要更新的字段，步骤跳过'
                };
            }

            const allSuccess = updateResults.every(r => r.success);
            const failedItems = updateResults.filter(r => !r.success);
            const firstPurchaseOrder = poMapping[0]?.purchaseOrder || '';
            
            if (allSuccess) {
                console.log('所有采购订单行项目修改成功');
                return {
                    code: 'S',
                    message: '采购订单行项目修改成功',
                    objkey: firstPurchaseOrder
                };
            } else {
                const errorDetails = failedItems.map(i => {
                    const itemInfo = `${i.purchaseOrder}-${i.purchaseOrderItem}`;
                    if (i.errorMessage) {
                        return `${itemInfo}: ${i.errorMessage}`;
                    }
                    return itemInfo;
                }).join('; ');
                const errorMessage = `采购订单行项目修改失败: ${errorDetails}`;
                console.error(errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('PurchaseOrderItemUpdateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '采购订单行项目修改失败',
                objkey: ''
            };
        }
    }

    async getPOMappingFromPISalesOrderRel(businessDataList) {
        const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
        const mappings = [];
        
        for (const businessData of businessDataList) {
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = businessData.PIOrderItem || '';
            
            if (piOrder && piOrderItem) {
                const record = await cds.run(
                    SELECT.one.from(PISalesOrderRel)
                        .columns(['PurchaseOrder1', 'PurchaseOrderItem1'])
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                if (record && record.PurchaseOrder1 && record.PurchaseOrderItem1) {
                    mappings.push({
                        piOrder: piOrder,
                        piOrderItem: piOrderItem,
                        purchaseOrder: record.PurchaseOrder1,
                        purchaseOrderItem: record.PurchaseOrderItem1,
                        businessData: businessData
                    });
                }
            }
        }
        
        return mappings;
    }

    buildItemData(businessData, mptStepConfig) {
        const item = {};

        // 只有当字段有值时才添加到更新对象中
        if (businessData.Material) {
            item.Material = businessData.Material;
        }
        if (businessData.RequestedQuantity) {
            item.OrderQuantity = parseFloat(businessData.RequestedQuantity);
        }
        if (businessData.PurchasePrice) {
            item.NetPriceAmount = parseFloat(businessData.PurchasePrice);
        }

        return item;
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

module.exports = PurchaseOrderItemUpdateService;