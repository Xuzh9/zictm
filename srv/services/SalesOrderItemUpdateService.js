const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class SalesOrderItemUpdateService {
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

            // 使用通用工具类读取之前步骤的 objkey（销售订单号）
            let salesOrder = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                salesOrder = previousObjkey;
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
            const businessDataList = await this.commonUtils.getBusinessData(businessTable, salesOrder, 'SalesOrder');
            if (!businessDataList || businessDataList.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据，销售订单号: ${salesOrder}`,
                    objkey: ''
                };
            }

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 从 PISalesOrderRel 表获取行项目号映射
            const itemMapping = await this.getItemMappingFromPISalesOrderRel(businessDataList);

            // 获取 CSRF token（使用 OData V2 格式）
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/$metadata',
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
            
            // 逐条修改行项目
            const updateResults = [];
            for (const mapping of itemMapping) {
                const { purchaseOrderItem, businessData } = mapping;
                const salesOrderItem = purchaseOrderItem;
                
                // 构建行项目修改数据
                const itemData = this.buildItemData(businessData, mptStepConfig, salesOrderItem);
                
                console.log(`开始修改销售订单行项目: ${salesOrder} - ${salesOrderItem}`);
                console.log('修改数据:', JSON.stringify(itemData, null, 2));

                // 调用销售订单行项目修改 API（OData V2 格式）
                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'PATCH',
                        url: `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrderItem(SalesOrder='${salesOrder}',SalesOrderItem='${salesOrderItem}')`,
                        data: itemData,
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

                updateResults.push({
                    salesOrderItem: salesOrderItem,
                    status: result.status,
                    success: result.status >= 200 && result.status < 300
                });
            }

            // 检查所有行项目修改结果
            const allSuccess = updateResults.every(r => r.success);
            const failedItems = updateResults.filter(r => !r.success);
            
            if (allSuccess) {
                console.log('所有销售订单行项目修改成功:', salesOrder);
                return {
                    code: 'S',
                    message: '销售订单行项目修改成功',
                    objkey: salesOrder
                };
            } else {
                const errorMessage = `部分行项目修改失败: ${failedItems.map(i => i.salesOrderItem).join(', ')}`;
                console.error(errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('SalesOrderItemUpdateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '销售订单行项目修改失败',
                objkey: ''
            };
        }
    }

    /**
     * 从 PISalesOrderRel 表获取行项目号映射
     * @param {Array} businessDataList - 业务数据列表
     * @returns {Promise<Array>} 行项目号映射列表
     */
    async getItemMappingFromPISalesOrderRel(businessDataList) {
        const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
        const mappings = [];
        
        for (const businessData of businessDataList) {
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = businessData.PIOrderItem || '';
            
            if (piOrder && piOrderItem) {
                const record = await cds.run(
                    SELECT.one.from(PISalesOrderRel)
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                if (record && record.PurchaseOrderItem1) {
                    mappings.push({
                        piOrder: piOrder,
                        piOrderItem: piOrderItem,
                        purchaseOrderItem: record.PurchaseOrderItem1,
                        businessData: businessData
                    });
                } else {
                    console.warn(`未找到 PISalesOrderRel 记录: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}`);
                }
            }
        }
        
        return mappings;
    }

    buildItemData(businessData, mptStepConfig, salesOrderItem) {
        const item = {
            YY1_FD_FNSKU: businessData.YY1_FD_FNSKU,
            YY1_FD_SKU: businessData.YY1_FD_SKU,
        };

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
        } else {
            return JSON.stringify(errorData);
        }
    }
}

module.exports = SalesOrderItemUpdateService;