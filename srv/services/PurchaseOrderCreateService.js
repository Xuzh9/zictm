const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
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
            const { zrfcid, canum, serviceName, readsteps, objkey, zrfcLogid, zdfjy } = inputData;
            
            this.zrfcLogid = zrfcLogid;

            console.log('[PurchaseOrderService] 开始执行, zrfcid:', zrfcid, 'canum:', canum, 'zdfjy:', zdfjy);

            // 读取 ProcessConfig 表获取业务表名
            const businessTable = await this.getBusinessTable(zrfcid);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }
            console.log('[PurchaseOrderService] 业务表名:', businessTable);

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
            console.log('[PurchaseOrderService] 业务数据条数:', businessDataList.length);

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.getMPTStepConfig(zdfjy, canum);
            console.log('[PurchaseOrderService] MPTStepConfig:', mptStepConfig);

            // 构建采购订单数据，同时获取行号映射
            const { purchaseOrderData, itemMapping } = this.buildPurchaseOrderData(businessDataList, mptStepConfig);
            
            // 调试：打印请求数据
            console.log('[PurchaseOrderService] 请求数据:', JSON.stringify(purchaseOrderData, null, 2));
 
            // 获取 CSRF token
            console.log('[PurchaseOrderService] 开始获取 CSRF token...');
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/$metadata',
                    headers: {
                        'X-CSRF-Token': 'Fetch'
                    }
                }
            );
            console.log('[PurchaseOrderService] CSRF token 获取成功, status:', csrfResult.status);

            // 提取 cookie 和 CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];
            
            // 调试：打印请求头
            console.log('[PurchaseOrderService] 请求头:', {
                'X-CSRF-Token': csrfToken,
                'Content-Type': 'application/json;charset=UTF-8',
                'Cookie': cookieString,
                'sap-language': 'ZH'
            });
            
            // 直接传递对象，跟 MaterialDocumentService 保持一致
            console.log('[PurchaseOrderService] 开始调用采购订单 API...');
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
                        'Content-Type': 'application/json;charset=UTF-8',
                        'Cookie': cookieString,
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true; // 接受所有状态码
                    }
                }
            );

            // 调试：打印响应信息
            console.log('[PurchaseOrderService] API 响应状态:', result.status);
            console.log('[PurchaseOrderService] API 响应头:', result.headers);
            console.log('[PurchaseOrderService] API 响应数据:', JSON.stringify(result.data, null, 2));

            if (result.status >= 200 && result.status < 300) {
                // OData V4 响应格式
                const purchaseOrder = result.data.PurchaseOrder || '';
                
                // 更新 PISalesOrderRel 表中的 PurchaseOrder1 和 PurchaseOrderItem1
                await this.updatePISalesOrderRel(purchaseOrder, itemMapping);
                
                return {
                    code: 'S',
                    message: '采购订单创建成功',
                    objkey: purchaseOrder
                };
            } else {
                let errorMessage = `API 调用失败: ${result.status}`;
                if (result.data && result.data.error) {
                    const error = result.data.error;
                    // 优先取 details 中的消息
                    if (error.details && error.details.length > 0) {
                        const detailMessages = error.details.map(d => d.message).filter(m => m);
                        if (detailMessages.length > 0) {
                            errorMessage = detailMessages.join('; ');
                        }
                    }
                    // 如果没有 details 消息，则取主消息
                    if (errorMessage === `API 调用失败: ${result.status}`) {
                        if (error.message && error.message.value) {
                            errorMessage = error.message.value;
                        } else if (error.message) {
                            errorMessage = error.message;
                        }
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
            // 调试：打印完整错误信息
            console.error('[PurchaseOrderService] 错误详情:', {
                message: error.message,
                code: error.code,
                response: error.response ? {
                    status: error.response.status,
                    headers: error.response.headers,
                    data: error.response.data
                } : null,
                config: error.config ? {
                    method: error.config.method,
                    url: error.config.url,
                    headers: error.config.headers
                } : null
            });
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

    async getMPTStepConfig(zdfjy, canum) {
        if (!zdfjy || !canum) {
            return null;
        }
        
        try {
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

    async getBusinessData(businessTable, objkey) {
        try {
            const BusinessEntity = cds.entities[businessTable];
            
            if (!BusinessEntity) {
                return {
                    code: 'E',
                    message: `业务表实体不存在: ${businessTable}`,
                    businessData: []
                };
            }

            const businessData = await cds.run(
                SELECT.from(BusinessEntity).where({ zrfc_logid: objkey })
            );

            if (!businessData || businessData.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据: ${businessTable}, zrfc_logid=${objkey}`,
                    businessData: []
                };
            }

            return {
                code: 'S',
                message: '查询成功',
                businessData
            };
        } catch (error) {
            console.error('读取业务数据失败:', error);
            return {
                code: 'E',
                message: `读取业务数据失败: ${error.message}`,
                businessData: []
            };
        }
    }

    buildPurchaseOrderData(businessDataList, mptStepConfig) {
        const itemMapping = [];
        
        // 获取第一行数据作为主数据
        const mainData = businessDataList[0];
        
        // 构建采购订单行项目数据
        const purchaseOrderItems = businessDataList.map((item, index) => {
            // 保存 PIOrderItem 和行号的映射关系
            const poItemNumber = ((index + 1) * 10).toString().padStart(5, '0');
            itemMapping.push({
                PIOrder: item.PIOrder,
                PIOrderItem: item.PIOrderItem,
                poItemNumber: poItemNumber
            });

            return {
                PurchaseOrderItem: poItemNumber,
                Material: item.Material || "",
                Plant: mptStepConfig?.umwrk || "",
                StorageLocation: mptStepConfig?.lgort || "",
                PurchaseOrderQuantityUnit: item.RequestedQuantityUnit,
                TaxCode: mptStepConfig?.mwskz || "",
                OrderQuantity: item.RequestedQuantity ? parseFloat(item.RequestedQuantity) : 0,
                NetPriceAmount: item.PurchasePrice ? parseFloat(item.PurchasePrice) : 0,
                DocumentCurrency: item.TransactionCurrency || "",
                _PurchaseOrderScheduleLineTP: [{
                    PurchaseOrderItem: poItemNumber,
                    ScheduleLine: "1",
                    ScheduleLineDeliveryDate: item.ConfirmedDeliveryDate || ""
                }],
                _PurOrdPricingElement: [{
                    PurchaseOrderItem: poItemNumber,
                    ConditionType: "ZQU1",
                    ConditionBaseAmount: 0.01,
                    ConditionCurrency: item.TransactionCurrency || "",
                    FreightSupplier: "600000"
                }, {
                    PurchaseOrderItem: poItemNumber,
                    ConditionType: "ZQU2",
                    ConditionBaseAmount: 0.01,
                    ConditionCurrency: item.TransactionCurrency || "",
                    FreightSupplier: "600000"
                }]
            };
        });

        // 构建采购订单主数据（包含行项目）
        let purchaseOrderData = {
            PurchaseOrderType: 'Z09',
            CompanyCode: mainData.SalesDistrict || "",
            PurchasingOrganization: mptStepConfig?.ekorg || "",
            PurchasingGroup: mptStepConfig?.ekgrp || "",
            Supplier: mainData.ProductionPlant,
            DocumentCurrency: mainData.TransactionCurrency || "",
            YY1_FD_ZDFJY2_PDH: mainData.YY1_FD_ZDFJY,
            SupplyingPlant: mainData.ProductionPlant,
            _PurchaseOrderItem: purchaseOrderItems
        };

        // 只有当日期有值时才添加 PurchaseOrderDate 字段
        if (mainData.ConfirmedDeliveryDate) {
            purchaseOrderData.PurchaseOrderDate = mainData.ConfirmedDeliveryDate;
        }

        // 如果存在 MPTStepConfig，应用主数据字段映射
        if (mptStepConfig && mptStepConfig.mainDataMapping) {
            try {
                const mainDataMapping = JSON.parse(mptStepConfig.mainDataMapping);
                Object.keys(mainDataMapping).forEach(targetField => {
                    const sourceField = mainDataMapping[targetField];
                    if (mainData[sourceField] !== undefined) {
                        purchaseOrderData[targetField] = mainData[sourceField];
                    }
                });
            } catch (e) {
                console.error('解析主数据映射失败:', e);
            }
        }

        return { purchaseOrderData, itemMapping };
    }

    async updatePISalesOrderRel(purchaseOrder, itemMapping) {
        try {
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const { INSERT, UPDATE } = cds.ql;
            
            for (const mapping of itemMapping) {
                // 先尝试更新
                const updateResult = await cds.run(
                    UPDATE(PISalesOrderRel)
                        .set({
                            PurchaseOrder1: purchaseOrder,
                            PurchaseOrderItem1: mapping.poItemNumber
                        })
                        .where({
                            PIOrder: mapping.PIOrder,
                            PIOrderItem: mapping.PIOrderItem
                        })
                );
                
                // 如果没有更新到数据（表中没有该记录），则插入新记录
                if (updateResult?.affectedRows === 0 || !updateResult) {
                    await cds.run(
                        INSERT.into(PISalesOrderRel).entries({
                            zrfc_logid: this.zrfcLogid,
                            PIOrder: mapping.PIOrder,
                            PIOrderItem: mapping.PIOrderItem,
                            PurchaseOrder1: purchaseOrder,
                            PurchaseOrderItem1: mapping.poItemNumber
                        })
                    );
                }
            }
            
            console.log(`已更新/插入 PISalesOrderRel 表: ${itemMapping.length} 条记录`);
        } catch (error) {
            console.error('更新 PISalesOrderRel 表失败:', error);
        }
    }
}

module.exports = PurchaseOrderService;
