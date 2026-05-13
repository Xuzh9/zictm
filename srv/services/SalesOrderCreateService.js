const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

class SalesOrderCreateService {
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
            const { zrfcid, canum, serviceName, readsteps, objkey, zrfcLogid, zdfjy } = inputData;
            
            this.zrfcLogid = zrfcLogid;

            console.log('[SalesOrderCreateService] 开始执行, zrfcid:', zrfcid, 'canum:', canum, 'zdfjy:', zdfjy);

            // 读取 ProcessConfig 表获取业务表名
            const businessTable = await this.getBusinessTable(zrfcid);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }
            console.log('[SalesOrderCreateService] 业务表名:', businessTable);

            // 读取业务表数据
            const businessDataResult = await this.getBusinessData(businessTable, zrfcLogid);
            if (businessDataResult.code === 'E') {
                return {
                    code: 'E',
                    message: businessDataResult.message,
                    objkey: ''
                };
            }
            const businessDataList = businessDataResult.businessData;
            console.log('[SalesOrderCreateService] 业务数据条数:', businessDataList.length);

            // 根据业务表的 SalesOrganization 和 ReceivingPlant 查找 MPTStepConfig 配置
            const mptStepConfig = await this.getMPTStepConfig(businessDataList, canum);
            console.log('[SalesOrderCreateService] MPTStepConfig:', mptStepConfig);

            // 构建销售订单数据
            const salesOrderData = this.buildSalesOrderData(businessDataList, mptStepConfig);
            
            // 调试：打印请求数据
            console.log('[SalesOrderCreateService] 请求数据:', JSON.stringify(salesOrderData, null, 2));
 
            // 获取 CSRF token
            console.log('[SalesOrderCreateService] 开始获取 CSRF token...');
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/$metadata',
                    headers: {
                        'X-CSRF-Token': 'Fetch'
                    }
                }
            );
            console.log('[SalesOrderCreateService] CSRF token 获取成功, status:', csrfResult.status);

            // 提取 cookie 和 CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];
            
            // 调用销售订单创建 API
            console.log('[SalesOrderCreateService] 开始调用销售订单 API...');
            const result = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'POST',
                    url: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder',
                    data: salesOrderData,
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        'Content-Type': 'application/json;charset=UTF-8',
                        'Cookie': cookieString,
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            // 调试：打印响应信息
            console.log('[SalesOrderCreateService] API 响应状态:', result.status);
            console.log('[SalesOrderCreateService] API 响应头:', result.headers);
            console.log('[SalesOrderCreateService] API 响应数据:', JSON.stringify(result.data, null, 2));

            if (result.status >= 200 && result.status < 300) {
                // OData V4 响应格式
                const salesOrder = result.data.SalesOrder || '';
                
                // 更新 PISalesOrderRel 表中的 SalesOrder 字段
                await this.updatePISalesOrderRel(salesOrder, businessDataList);
                
                return {
                    code: 'S',
                    message: '销售订单创建成功',
                    objkey: salesOrder
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
                console.error('[SalesOrderCreateService] 执行失败:', errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }
        } catch (error) {
            console.error('[SalesOrderCreateService] 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '销售订单创建失败',
                objkey: ''
            };
        }
    }

    /**
     * 获取业务流程配置
     */
    async getBusinessTable(zrfcid) {
        const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
        const config = await cds.run(
            SELECT.one.from(ProcessConfig).where({ zrfcid: zrfcid })
        );
        return config ? config.businessTable1 : null;
    }

    /**
     * 获取业务数据
     */
    async getBusinessData(businessTable, zrfcLogid) {
        try {
            const entity = cds.entities[`com.sap.zictm.${businessTable}`];
            if (!entity) {
                return { code: 'E', message: `业务表不存在: ${businessTable}` };
            }
            
            const businessData = await cds.run(
                SELECT.from(entity).where({ zrfc_logid: zrfcLogid })
            );
            
            if (!businessData || businessData.length === 0) {
                return { code: 'E', message: `未找到业务数据: ${zrfcLogid}` };
            }
            
            return { code: 'S', businessData };
        } catch (error) {
            console.error('[SalesOrderCreateService.getBusinessData] 执行失败:', error);
            return { code: 'E', message: error.message };
        }
    }

    /**
     * 获取步骤配置
     * 通过业务表的 SalesOrganization(zxsf) 和 ReceivingPlant(zfcf) 查找
     */
    async getMPTStepConfig(businessDataList, canum) {
        if (!businessDataList || businessDataList.length === 0 || !canum) {
            return null;
        }
        
        try {
            const mainData = businessDataList[0];
            const salesOrganization = mainData.SalesOrganization;
            const receivingPlant = mainData.ReceivingPlant;
            
            console.log('[SalesOrderCreateService.getMPTStepConfig] SalesOrganization:', salesOrganization, 'ReceivingPlant:', receivingPlant);
            
            // 首先通过 SalesOrganization(zxsf) 和 ReceivingPlant(zfcf) 查找 MPTTypeConfig 获取 zdfjy
            const MPTTypeConfig = cds.entities['com.sap.zictm.MPTTypeConfig'];
            const mptTypeConfig = await cds.run(
                SELECT.one.from(MPTTypeConfig)
                    .where({ zxsf: salesOrganization, zfcf: receivingPlant })
            );
            
            if (!mptTypeConfig) {
                console.log('[SalesOrderCreateService.getMPTStepConfig] 未找到 MPTTypeConfig 配置');
                return null;
            }
            
            const zdfjy = mptTypeConfig.zdfjy;
            console.log('[SalesOrderCreateService.getMPTStepConfig] 找到 zdfjy:', zdfjy);
            
            // 然后通过 zdfjy 和 canum 查找 MPTStepConfig
            const MPTStepConfig = cds.entities['com.sap.zictm.MPTStepConfig'];
            const config = await cds.run(
                SELECT.one.from(MPTStepConfig)
                    .where({ zdfjy: zdfjy, canum: parseInt(canum) })
            );
            
            return config || null;
        } catch (error) {
            console.error('获取 MPTStepConfig 失败:', error);
            return null;
        }
    }

    /**
     * 构建销售订单数据
     */
    buildSalesOrderData(businessDataList, mptStepConfig) {
        if (!businessDataList || businessDataList.length === 0) {
            return {};
        }

        const mainData = businessDataList[0];
        
        // 构建行项目
        const salesOrderItems = businessDataList.map((item, index) => {
            // 使用业务表的 SalesOrderItem 字段，如果为空则使用递增编号
            const itemNumber = item.SalesOrderItem || ((index + 1) * 10).toString();
            
            return {
                SalesOrderItem: itemNumber,
                SalesOrderItemCategory: "TAN",
                Material: item.Product || "",
                ProductionPlant: item.ReceivingPlant || "",
                RequestedQuantity: item.RequestedQuantity ? parseFloat(item.RequestedQuantity).toString() : "0",
                RequestedQuantityUnit: item.RequestedQuantityUnit || "PCS",
                to_PricingElement: {
                    results: [{
                        ConditionType: "ZB01",
                        ConditionRateValue: item.PurchasePrice ? parseFloat(item.PurchasePrice).toString() : "0",
                        ConditionQuantity: "1",
                        ConditionQuantityUnit: "PCS"
                    }]
                }
            };
        });

        // 构建销售订单主数据
        let salesOrderData = {
            SalesOrderType: mainData.SalesOrderType || "",
            SalesOrganization: mptStepConfig?.vkorg || "",
            DistributionChannel: mptStepConfig?.vtweg || "",
            OrganizationDivision: mptStepConfig?.spart || "00",
            SalesOffice: mptStepConfig?.vkbur || "",
            SalesGroup: mptStepConfig?.vkgrp || "",
            SoldToParty: mptStepConfig?.kunnr || "",
            PurchaseOrderByCustomer: mainData.PIOrder || "",
            TransactionCurrency: mainData.TransactionCurrency || "CNY",
            CustomerPaymentTerms: mptStepConfig?.zterm || "NT15",
            SDDocumentReason: "",
            to_Item: {
                results: salesOrderItems
            },
            to_Partner: {
                results: [{
                    PartnerFunction: "SE",
                    Customer: mptStepConfig?.kunnr || ""
                }]
            }
        };

        // 如果有日期值则添加
        if (mainData.RequestedDeliveryDate) {
            salesOrderData.RequestedDeliveryDate = mainData.RequestedDeliveryDate;
        }
        if (mainData.SalesOrderDate) {
            salesOrderData.CustomerPurchaseOrderDate = mainData.SalesOrderDate;
        }

        return salesOrderData;
    }
}

module.exports = SalesOrderCreateService;