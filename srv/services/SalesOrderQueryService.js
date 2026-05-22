const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class SalesOrderQueryService {
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
            this.zrfcid = zrfcid;

            // 使用通用工具类读取之前步骤的 objkey
            let purchaseOrderByCustomer = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                purchaseOrderByCustomer = previousObjkey;
            }

            // 根据条件查询销售订单
            return await this.querySalesOrderByCondition(purchaseOrderByCustomer, zrfcid, canum);

        } catch (error) {
            console.error('SalesOrderQueryService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '查询销售订单失败',
                objkey: ''
            };
        }
    }

    async querySalesOrderByCondition(purchaseOrderByCustomer, zrfcid, canum) {
        const maxRetries = 10;
        const retryDelay = 1000; // 1秒
        
        // 构建查询条件
        const filters = [];
        
        // 添加销售订单类型条件（CBIC）
        filters.push("SalesOrderType eq 'CBIC'");
        
        // 添加客户采购订单号条件
        if (purchaseOrderByCustomer) {
            // 对特殊字符进行编码
            const encodedValue = encodeURIComponent(purchaseOrderByCustomer);
            filters.push(`PurchaseOrderByCustomer eq '${encodedValue}'`);
        }

        // 构建完整的 filter 参数，增加 $expand=to_Item 展开行项目
        const filterStr = filters.join(' and ');
        const url = `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder?$filter=${filterStr}&$expand=to_Item`;

        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
            try {
                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'GET',
                        url: url,
                        headers: {
                            'Content-Type': 'application/json',
                            'sap-language': 'ZH'
                        },
                        validateStatus: function (status) {
                            return true;
                        }
                    }
                );

                if (result.status >= 200 && result.status < 300) {
                    const responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
                    // OData V2 返回格式: { d: { results: [...] } }
                    const salesOrder = responseData?.d?.results?.[0] || responseData?.results?.[0];
                    
                    // 只会查到1条数据，不存在则继续重试
                    if (!salesOrder) {
                        if (retryCount < maxRetries - 1) {
                            console.log(`查询销售订单失败（未找到数据），将在 ${retryDelay}ms 后重试（${retryCount + 1}/${maxRetries}）`);
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                            continue;
                        } else {
                            return {
                                code: 'E',
                                message: `超过最大重试次数(${maxRetries})，未找到匹配的销售订单，PurchaseOrderByCustomer: ${purchaseOrderByCustomer}`,
                                objkey: ''
                            };
                        }
                    }

                    const salesOrderNumber = salesOrder.SalesOrder;
                    const salesOrderItems = salesOrder.to_Item?.results || [];
                    
                    console.log('找到销售订单:', salesOrderNumber);
                    console.log('销售订单行项目数量:', salesOrderItems.length);

                    // 更新 PISalesOrderRel 表
                    if ((zrfcid === 'SD01' || zrfcid === 'SD06' || zrfcid === 'SD08') && salesOrderItems.length > 0) {
                        await this.updatePISalesOrderRel(purchaseOrderByCustomer, salesOrderItems, zrfcid, canum);
                    }

                    return {
                        code: 'S',
                        message: '查询成功',
                        objkey: salesOrderNumber
                    };
                } else {
                    // HTTP状态码异常，继续重试
                    if (retryCount < maxRetries - 1) {
                        console.log(`查询销售订单失败，HTTP状态码: ${result.status}，将在 ${retryDelay}ms 后重试（${retryCount + 1}/${maxRetries}）`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        continue;
                    } else {
                        const errorMessage = this.parseError(result.data);
                        return {
                            code: 'E',
                            message: `超过最大重试次数(${maxRetries})，错误信息: ${errorMessage}`,
                            objkey: ''
                        };
                    }
                }
            } catch (error) {
                // 网络异常或其他错误，继续重试
                if (retryCount < maxRetries - 1) {
                    console.log(`查询销售订单异常: ${error.message}，将在 ${retryDelay}ms 后重试（${retryCount + 1}/${maxRetries}）`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                } else {
                    return {
                        code: 'E',
                        message: `超过最大重试次数(${maxRetries})，异常信息: ${error.message}`,
                        objkey: ''
                    };
                }
            }
        }
    }

    async updatePISalesOrderRel(purchaseOrderByCustomer, salesOrderItems, zrfcid, canum) {
        try {
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const salesOrderNumber = salesOrderItems[0]?.SalesOrder;
            
            // 遍历销售订单行项目，更新对应的 PISalesOrderRel 记录
            for (const item of salesOrderItems) {
                const itemPurchaseOrderByCustomer = item.PurchaseOrderByCustomer;
                const underlyingPurchaseOrderItem = item.UnderlyingPurchaseOrderItem;
                
                if (itemPurchaseOrderByCustomer && underlyingPurchaseOrderItem) {
                    // 格式化字段值以匹配数据库存储格式
                    // PurchaseOrder1: 10位, PurchaseOrderItem1: 5位, SalesOrderItem1: 6位
                    const formattedPurchaseOrder = String(itemPurchaseOrderByCustomer).padStart(10, '0');
                    const formattedSalesOrderItem = String(item.SalesOrderItem).padStart(6, '0');
                    
                    // 根据 zrfcid 和 canum 决定更新哪些字段
                    let updateData;
                    if (zrfcid === 'SD08' && canum === 50) {
                        updateData = {
                            SalesOrder2: salesOrderNumber,
                            SalesOrderItem2: formattedSalesOrderItem
                        };
                    } else {
                        updateData = {
                            SalesOrder1: salesOrderNumber,
                            SalesOrderItem1: formattedSalesOrderItem
                        };
                    }
                    
                    // 根据 to_Item.PurchaseOrderByCustomer = PurchaseOrder1 和 to_Item.UnderlyingPurchaseOrderItem = PurchaseOrderItem1 更新记录
                    const affectedRows = await cds.run(
                        UPDATE(PISalesOrderRel)
                            .set(updateData)
                            .where({
                                PurchaseOrder1: formattedPurchaseOrder,
                                PurchaseOrderItem1: String(item.UnderlyingPurchaseOrderItem).padStart(5, '0')
                            })
                    );
                    
                    console.log(`更新 PISalesOrderRel: PurchaseOrder1=${formattedPurchaseOrder}, PurchaseOrderItem1=${String(item.UnderlyingPurchaseOrderItem).padStart(5, '0')} -> ${JSON.stringify(updateData)}, 更新行数: ${affectedRows}`);
                }
            }
        } catch (error) {
            console.error('更新 PISalesOrderRel 失败:', error);
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

        // 处理 OData V2 错误格式
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

module.exports = SalesOrderQueryService;