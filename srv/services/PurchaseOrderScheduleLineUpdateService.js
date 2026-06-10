const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class PurchaseOrderScheduleLineUpdateService {
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
            const itemMapping = await this.getItemMappingFromPISalesOrderRel(businessDataList);

            if (itemMapping.length === 0) {
                console.log('所有业务数据都没有找到对应的采购订单，步骤跳过');
                return {
                    code: 'S',
                    message: '所有业务数据都没有找到对应的采购订单，步骤跳过',
                    objkey: ''
                };
            }

            // 获取第一个采购订单号用于后续返回
            const firstPurchaseOrder = itemMapping[0].purchaseOrder;
            
            // 循环处理每个行项目的计划行
            const updateResults = [];
            for (const mapping of itemMapping) {
                const { purchaseOrder, purchaseOrderItem, businessData } = mapping;
                
                // 构建计划行修改数据
                const scheduleLineData = this.buildScheduleLineData(businessData, mptStepConfig);
                
                // 如果没有需要更新的字段，跳过该行项目
                if (Object.keys(scheduleLineData).length === 0) {
                    console.log(`采购订单 ${purchaseOrder} 行项目 ${purchaseOrderItem} 的计划行没有需要更新的字段，跳过`);
                    continue;
                }
                
                // 获取 CSRF token 和 ETag（为每个计划行单独获取）
                const csrfResult = await executeHttpRequest(
                    {
                        destinationName: this.commonUtils.getDestinationName()
                    },
                    {
                        method: 'GET',
                        url: `/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrderScheduleLine/${purchaseOrder}/${purchaseOrderItem}/1`,
                        headers: {
                            'X-CSRF-Token': 'Fetch'
                        }
                    }
                );
                
                const cookies = csrfResult.headers['set-cookie'] || [];
                const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
                const csrfToken = csrfResult.headers['x-csrf-token'];
                const etag = csrfResult.headers['etag'] || csrfResult.headers['ETag'];
                
                console.log(`开始修改采购订单 ${purchaseOrder} 行项目 ${purchaseOrderItem} 的计划行`);
                console.log('修改数据:', JSON.stringify(scheduleLineData, null, 2));

                // 调用采购订单计划行修改 API
                const result = await executeHttpRequest(
                    {
                        destinationName: this.commonUtils.getDestinationName()
                    },
                    {
                        method: 'PATCH',
                        url: `/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrderScheduleLine/${purchaseOrder}/${purchaseOrderItem}/1`,
                        data: scheduleLineData,
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

            // 如果没有任何计划行需要更新，返回跳过状态
            if (updateResults.length === 0) {
                console.log('所有采购订单计划行都没有需要更新的字段，步骤跳过');
                return {
                    code: 'S',
                    message: '所有采购订单计划行都没有需要更新的字段，步骤跳过',
                    objkey: firstPurchaseOrder
                };
            }

            const allSuccess = updateResults.every(r => r.success);
            const failedItems = updateResults.filter(r => !r.success);
            
            if (allSuccess) {
                console.log('所有采购订单计划行修改成功');
                return {
                    code: 'S',
                    message: '采购订单计划行修改成功',
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
                const errorMessage = `采购订单计划行修改失败: ${errorDetails}`;
                console.error(errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('PurchaseOrderScheduleLineUpdateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '采购订单计划行修改失败',
                objkey: ''
            };
        }
    }

    async getItemMappingFromPISalesOrderRel(businessDataList) {
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

    buildScheduleLineData(businessData, mptStepConfig) {
        const scheduleLine = {};

        // ScheduleLineDeliveryDate:计划行日期
        if (businessData.ConfirmedDeliveryDate ) {
            scheduleLine.ScheduleLineDeliveryDate = businessData.ConfirmedDeliveryDate ;
        }

        return scheduleLine;
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

module.exports = PurchaseOrderScheduleLineUpdateService;
