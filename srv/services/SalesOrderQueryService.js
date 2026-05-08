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

            // 使用通用工具类读取之前步骤的 objkey
            let purchaseOrderByCustomer = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                purchaseOrderByCustomer = previousObjkey;
            }

            // 根据条件查询销售订单
            return await this.querySalesOrderByCondition(purchaseOrderByCustomer);

        } catch (error) {
            console.error('SalesOrderQueryService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '查询销售订单失败',
                objkey: ''
            };
        }
    }

    async querySalesOrderByCondition(purchaseOrderByCustomer) {
  
        // 构建查询条件
        const filters = [];
        
        // 添加销售订单类型条件（CBIC）
        filters.push("SalesOrderTypeInternalCode eq 'CBIC'");
        
        // 添加客户采购订单号条件
        if (purchaseOrderByCustomer) {
            // 对特殊字符进行编码
            const encodedValue = encodeURIComponent(purchaseOrderByCustomer);
            filters.push(`PurchaseOrderByCustomer eq '${encodedValue}'`);
        }

        // 构建完整的 filter 参数（不需要查询行项目，只查一条）
        const filterStr = filters.join(' and ');
        const url = `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder?$filter=${filterStr}&$top=1`;

        const result = await executeHttpRequest(
            {
                destinationName: 'ES_API'
            },
            {
                method: 'GET',
                url: url,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'sap-language': 'ZH'
                },
                validateStatus: function (status) {
                    return true;
                }
            }
        );

        if (result.status >= 200 && result.status < 300) {
            const responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
            // $top=1 返回的是单个对象，不是数组
            const salesOrder = responseData?.d || responseData;
            
            if (!salesOrder || (!salesOrder.SalesOrder && !salesOrder.salesOrder)) {
                return {
                    code: 'E',
                    message: `未找到匹配的销售订单，PurchaseOrderByCustomer: ${purchaseOrderByCustomer}`,
                    objkey: ''
                };
            }

            const salesOrderNumber = salesOrder.SalesOrder;
            
            console.log('找到销售订单:', salesOrderNumber);

            // 只要查到 SalesOrder 就代表成功，objkey 设为 SalesOrder 号用于后续步骤
            return {
                code: 'S',
                message: '查询成功',
                objkey: salesOrderNumber
            };
        } else {
            const errorMessage = this.parseError(result.data);
            return {
                code: 'E',
                message: errorMessage,
                objkey: ''
            };
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