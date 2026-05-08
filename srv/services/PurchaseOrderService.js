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
            const { zrfcid, canum, serviceName, readsteps, objkey, zrfcLogid, zdfjy } = inputData;
            
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

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.getMPTStepConfig(zdfjy, canum);

            // 构建采购订单数据，同时获取行号映射
            const { purchaseOrderData, itemMapping } = this.buildPurchaseOrderData(businessDataList, mptStepConfig);
 
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

    buildPurchaseOrderData(businessDataList, mptStepConfig) {
        const firstBusinessData = businessDataList[0];
        
        // OData V4 格式 - 使用 ISO 日期格式
        // 从 MPTStepConfig 获取配置字段
        const header = {
            PurchaseOrderType: 'Z07',
            PurchasingOrganization: mptStepConfig?.ekorg,
            PurchasingGroup: mptStepConfig?.ekgrp,
            CompanyCode: firstBusinessData.SalesDistrict,
            Currency: firstBusinessData.TransactionCurrency,
            PurchaseOrderDate: firstBusinessData.SalesOrderDate,
            Supplier: mptStepConfig?.lifnr
        };

        const items = [];
        // 用于记录业务数据索引与行项目号的映射关系
        const itemMapping = [];
        
        for (let index = 0; index < businessDataList.length; index++) {
            const businessData = businessDataList[index];
            const purchaseOrderItem = String(items.length + 10);
            
            // 获取业务数据中的金额（如 NetPriceAmount 或其他金额字段）
            const baseAmount = 100;
            // 获取 MPTStepConfig 中的 zjgbl（加价比例，存储为百分比），默认为 100（即 100%）
            const zjgblPercent = parseFloat(mptStepConfig?.zjgbl) || 100;
            // 计算最终金额：金额 * (加价百分比 / 100)
            const calculatedNetPriceAmount = baseAmount * (zjgblPercent / 100);
            
            const item = {
                PurchaseOrderItem: purchaseOrderItem,
                Material: businessData.Material,
                Plant: businessData.ProductionPlant,
                StorageLocation: mptStepConfig?.umwrk,
                OrderQuantity: businessData.RequestedQuantity,
                NetPriceAmount: calculatedNetPriceAmount,
                DocumentCurrency: businessData.TransactionCurrency,
                TaxCode: mptStepConfig?.mwskz
            };

            items.push(item);
            
            // 记录映射关系：业务数据索引 -> 行项目号（包含计算后的金额）
            itemMapping.push({
                index: index,
                purchaseOrderItem: purchaseOrderItem,
                piOrder: businessData.PIOrder || '',
                piOrderItem: businessData.PIOrderItem || '',
                netPriceAmount: calculatedNetPriceAmount
            });
        }

        if (items.length > 0) {
            header.PurchaseOrderItem = items;
        }

        return { purchaseOrderData: header, itemMapping };
    }

    async updatePISalesOrderRel(purchaseOrder, itemMapping) {
        try {
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            
            // 遍历行号映射，更新或插入对应的 PISalesOrderRel 记录
            for (const mapping of itemMapping) {
                const { piOrder, piOrderItem, purchaseOrderItem, netPriceAmount } = mapping;
                
                if (!piOrder || !piOrderItem) {
                    continue; // 没有 PI 信息，跳过
                }
                
                // 先查询是否存在记录
                const existingRecord = await cds.run(
                    SELECT.one.from(PISalesOrderRel)
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                if (existingRecord) {
                    // 如果存在记录，执行更新（包含 NetPriceAmount）
                    await cds.run(
                        UPDATE(PISalesOrderRel)
                            .set({
                                PurchaseOrder1: purchaseOrder,
                                PurchaseOrderItem1: purchaseOrderItem,
                                NetPriceAmount: netPriceAmount
                            })
                            .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                    );
                } else {
                    // 如果不存在记录，执行插入（包含 NetPriceAmount）
                    await cds.run(
                        INSERT.into(PISalesOrderRel).entries({
                            PIOrder: piOrder,
                            PIOrderItem: piOrderItem,
                            PurchaseOrder1: purchaseOrder,
                            PurchaseOrderItem1: purchaseOrderItem,
                            NetPriceAmount: netPriceAmount
                        })
                    );
                }
            }
            
            console.log(`已更新/插入 PISalesOrderRel 表，采购订单号: ${purchaseOrder}`);
        } catch (error) {
            console.error('更新/插入 PISalesOrderRel 表失败:', error);
            // 更新失败不影响主流程，继续执行
        }
    }
}

module.exports = PurchaseOrderService;