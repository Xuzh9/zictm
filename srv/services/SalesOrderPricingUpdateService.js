const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class SalesOrderPricingUpdateService {
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
            
            // 先查询当前定价元素信息
            const pricingElements = await this.getPricingElements(salesOrder, csrfToken, cookieString);
            
            // 构建并更新定价元素
            const updateResults = await this.updatePricingElements(
                salesOrder, 
                businessDataList, 
                itemMapping,
                pricingElements, 
                mptStepConfig, 
                csrfToken, 
                cookieString
            );

            // 检查所有定价元素修改结果
            const allSuccess = updateResults.every(r => r.success);
            const failedItems = updateResults.filter(r => !r.success);
            
            if (allSuccess) {
                console.log('所有销售订单定价元素修改成功:', salesOrder);
                return {
                    code: 'S',
                    message: '销售订单定价修改成功',
                    objkey: salesOrder
                };
            } else {
                const errorMessage = `部分定价元素修改失败: ${failedItems.map(i => i.salesOrderItem).join(', ')}`;
                console.error(errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('SalesOrderPricingUpdateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '销售订单定价修改失败',
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
                        .columns(['PurchaseOrderItem1', 'NetPriceAmount'])
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                if (record && record.PurchaseOrderItem1) {
                    mappings.push({
                        piOrder: piOrder,
                        piOrderItem: piOrderItem,
                        purchaseOrderItem: record.PurchaseOrderItem1,
                        netPriceAmount: record.NetPriceAmount || 0,
                        businessData: businessData
                    });
                } else {
                    console.warn(`未找到 PISalesOrderRel 记录: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}`);
                }
            }
        }
        
        return mappings;
    }

    /**
     * 查询销售订单的定价元素
     */
    async getPricingElements(salesOrder, csrfToken, cookieString) {
        const url = `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder('${salesOrder}')/to_SalesOrderItem/to_SalesOrderItemPrElement`;
        
        console.log('查询定价元素 URL:', url);

        const result = await executeHttpRequest(
            {
                destinationName: 'ES_API'
            },
            {
                method: 'GET',
                url: url,
                headers: {
                    'X-CSRF-Token': csrfToken,
                    'Accept': 'application/json',
                    'Cookie': cookieString,
                    'sap-language': 'ZH'
                },
                validateStatus: function (status) {
                    return true;
                }
            }
        );

        if (result.status >= 200 && result.status < 300) {
            const responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
            return responseData?.d?.results || responseData?.value || [];
        } else {
            console.warn('查询定价元素失败，将使用默认定价元素配置');
            return [];
        }
    }

    /**
     * 更新销售订单定价元素
     */
    async updatePricingElements(salesOrder, businessDataList, itemMapping, pricingElements, mptStepConfig, csrfToken, cookieString) {
        const updateResults = [];
        
        // 按行项目分组定价元素
        const elementsByItem = {};
        for (const element of pricingElements) {
            const itemKey = element.SalesOrderItem;
            if (!elementsByItem[itemKey]) {
                elementsByItem[itemKey] = [];
            }
            elementsByItem[itemKey].push(element);
        }

        for (const mapping of itemMapping) {
            const { purchaseOrderItem, netPriceAmount, businessData } = mapping;
            const salesOrderItem = purchaseOrderItem;
            
            // 从 PISalesOrderRel 表获取 NetPriceAmount（直接使用，不再计算加价）
            console.log(`处理行项目 ${salesOrderItem}，价格: ${netPriceAmount}`);

            // 获取该行项目的定价元素
            const itemElements = elementsByItem[salesOrderItem] || [];
            
            // 找到定价类型 PMP0
            const pmp0Element = itemElements.find(e => e.ConditionType === 'PMP0');
            
            if (pmp0Element) {
                // 更新现有定价元素
                const { PricingProcedureStep, PricingProcedureCounter } = pmp0Element;
                const url = `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrderItemPrElement(SalesOrder='${salesOrder}',SalesOrderItem='${salesOrderItem}',PricingProcedureStep='${PricingProcedureStep}',PricingProcedureCounter='${PricingProcedureCounter}')`;
                
                console.log('更新定价元素 URL:', url);

                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'PATCH',
                        url: url,
                        data: {
                            ConditionRateValue: netPriceAmount,
                            ConditionCurrency: businessData.TransactionCurrency || 'CNY'
                        },
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
            } else {
                // 如果找不到 PMP0 定价元素，记录警告
                console.warn(`行项目 ${salesOrderItem} 未找到 PMP0 定价元素，跳过`);
                updateResults.push({
                    salesOrderItem: salesOrderItem,
                    status: -1,
                    success: false,
                    message: '未找到 PMP0 定价元素'
                });
            }
        }

        return updateResults;
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

module.exports = SalesOrderPricingUpdateService;