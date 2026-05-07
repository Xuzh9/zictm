const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

class PurchaseOrderService {
    constructor() {
        this.zrfcLogid = null;
    }

    async initService(zrfcLogid, zrfcid, canum) {
        this.zrfcLogid = zrfcLogid;
        this.zrfcid = zrfcid;
        this.canum = canum;
    }

    async execute(inputData) {
        try {
            const { zrfcid, canum, serviceName, readsteps, objkey, zrfcLogid } = inputData;
            
            this.zrfcLogid = zrfcLogid;

            // 读取 ProcessConfig 表获取业务表名
            const businessTable = await this.getBusinessTable(zrfcid);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }

            // 读取业务表数据
            const businessDataResult = await this.getBusinessData(businessTable, objkey);
            if (businessDataResult.code === 'E') {
                return {
                    code: 'E',
                    message: businessDataResult.message,
                    objkey: ''
                };
            }
            const businessDataList = businessDataResult.businessData;

            // 构建采购订单数据
            const purchaseOrderData = this.buildPurchaseOrderData(businessDataList);
 
            // 获取 CSRF token
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/$metadata',
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
            
            const result = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'POST',
                    url: '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrder',
                    data: purchaseOrderData,
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Cookie': cookieString,
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true; // 接受所有状态码
                    }
                }
            );

            if (result.status >= 200 && result.status < 300) {
                // OData V4 响应格式
                const purchaseOrder = result.data.PurchaseOrder || '';
                
                return {
                    code: 'S',
                    message: '采购订单创建成功',
                    objkey: purchaseOrder
                };
            } else {
                let errorMessage = `API 调用失败: ${result.status}`;
                if (result.data && result.data.error) {
                    const error = result.data.error;
                    if (error.message && error.message.value) {
                        errorMessage = error.message.value;
                    } else if (error.message) {
                        errorMessage = error.message;
                    }
                    if (error.code) {
                        errorMessage = `${errorMessage} (${error.code})`;
                    }
                } else if (result.data && result.data.message) {
                    errorMessage = result.data.message;
                }
                errorMessage = errorMessage.substring(0, 500);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }
        } catch (error) {
            console.error('PurchaseOrderService 执行失败:', error);
            let errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            if (error.response && error.response.data && error.response.data.error) {
                const errorData = error.response.data.error;
                if (errorData.message && errorData.message.value) {
                    errorMessage = errorData.message.value;
                } else if (errorData.message) {
                    errorMessage = errorData.message;
                }
                if (errorData.code) {
                    errorMessage = `${errorMessage} (${errorData.code})`;
                }
                errorMessage = errorMessage.substring(0, 500);
            }
            return {
                code: 'E',
                message: errorMessage,
                objkey: ''
            };
        }
    }

    async getBusinessTable(zrfcid) {
        const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
        const config = await cds.run(SELECT.one.from(ProcessConfig).where({ zrfcid }));
        return config ? config.businessTable1 : null;
    }

    async getBusinessData(businessTable, objkey) {
        try {
            const BusinessEntity = cds.entities[businessTable];
            if (!BusinessEntity) {
                return {
                    code: 'E',
                    message: `业务表不存在: ${businessTable}`,
                    businessData: []
                };
            }

            let businessData;
            
            switch (businessTable) {
                case 'SalesOrderCreate':
                    if (objkey) {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ SalesOrder: objkey }));
                    } else {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
                    }
                    break;
                case 'SalesOrderChange':
                    if (objkey) {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ SalesOrder: objkey }));
                    } else {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
                    }
                    break;
                default:
                    businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
            }

            if (!businessData || businessData.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据: ${objkey || this.zrfcLogid}`,
                    businessData: []
                };
            }

            return {
                code: 'S',
                message: '获取业务数据成功',
                businessData
            };
        } catch (error) {
            console.error('获取业务数据失败:', error);
            return {
                code: 'E',
                message: error.message || '获取业务数据失败',
                businessData: []
            };
        }
    }

    buildPurchaseOrderData(businessDataList) {
        const firstBusinessData = businessDataList[0];
        
        // OData V4 格式 - 使用 ISO 日期格式
        const header = {
            PurchaseOrderType: firstBusinessData.SalesOrderType || 'NB',
            PurchasingOrganization: firstBusinessData.SalesOrganization || '',
            PurchasingGroup: firstBusinessData.SalesGroup || '',
            CompanyCode: firstBusinessData.OrganizationDivision || '',
            Currency: firstBusinessData.TransactionCurrency || 'CNY',
            DocumentDate: firstBusinessData.SalesOrderDate,
            Supplier: firstBusinessData.Customer || ''
        };

        const items = [];
        for (const businessData of businessDataList) {
            if (businessData.Material || businessData.Product) {
                const item = {
                    PurchaseOrderItem: String(items.length + 10),
                    Material: businessData.Material || businessData.Product || '',
                    Plant: businessData.ProductionPlant || '',
                    Quantity: businessData.RequestedQuantity || 0,
                    OrderQuantityUnit: businessData.RequestedQuantityUnit || 'PCS',
                    NetPriceAmount: businessData.ZP00_Value || 0,
                    DocumentCurrency: businessData.ZP00_CurrencyCode || 'CNY',
                    DeliveryDate: businessData.RequestedDeliveryDate || new Date().toISOString().split('T')[0]
                };

                items.push(item);
            }
        }

        if (items.length > 0) {
            header.PurchaseOrderItem = items;
        }

        return header;
    }
}

module.exports = PurchaseOrderService;