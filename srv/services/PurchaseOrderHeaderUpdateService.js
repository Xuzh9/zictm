const cds = require('@sap/cds');
const CommonUtils = require('../handlers/CommonUtils');

class PurchaseOrderHeaderUpdateService {
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

            // 从 PISalesOrderRel 表获取采购订单号映射
            const poMapping = await this.getPOMappingFromPISalesOrderRel(businessDataList);

            if (poMapping.length === 0) {
                return {
                    code: 'E',
                    message: '未找到 PISalesOrderRel 映射记录',
                    objkey: ''
                };
            }

            // 获取第一个采购订单号用于获取 CSRF token
            const firstPurchaseOrder = poMapping[0].purchaseOrder;

            // 构建采购订单修改数据
            const updateData = this.buildUpdateData(businessDataList, mptStepConfig);
            
            // 如果没有需要更新的字段，跳过此步骤
            if (Object.keys(updateData).length === 0) {
                console.log('采购订单没有需要更新的字段，步骤跳过');
                return {
                    code: 'S',
                    message: '采购订单没有需要更新的字段，步骤跳过',
                    objkey: firstPurchaseOrder
                };
            }

            // 获取 CSRF token（使用 OData V2 格式）
            const csrfResult = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'GET',
                    url: `/sap/opu/odata/sap/API_PURCHASE_ORDER_PROCESS_SRV/A_PurchaseOrder('${firstPurchaseOrder}')`,
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

            console.log(`开始修改采购订单: ${firstPurchaseOrder}`);
            console.log('修改数据:', JSON.stringify(updateData, null, 2));

            // 调用采购订单修改 API（OData V2 格式）
            const result = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'PATCH',
                    url: `/sap/opu/odata/sap/API_PURCHASE_ORDER_PROCESS_SRV/A_PurchaseOrder('${firstPurchaseOrder}')`,
                    data: updateData,
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        'Accept': 'application/json',
                        'Cookie': cookieString,
                        'sap-language': 'ZH',
                        'If-Match': etag || '*'
                    },
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            console.log('修改状态码:', result.status);

            if (result.status >= 200 && result.status < 300) {
                console.log('采购订单修改成功');
                return {
                    code: 'S',
                    message: '采购订单修改成功',
                    objkey: firstPurchaseOrder
                };
            } else {
                const errorMessage = this.parseError(result.data);
                console.error('采购订单修改失败:', errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('PurchaseOrderHeaderUpdateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '采购订单修改失败',
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
                
                if (record && record.PurchaseOrder1) {
                    mappings.push({
                        piOrder: piOrder,
                        piOrderItem: piOrderItem,
                        purchaseOrder: record.PurchaseOrder1,
                        purchaseOrderItem: record.PurchaseOrderItem1,
                        businessData: businessData
                    });
                } else {
                    console.warn(`未找到 PISalesOrderRel 记录或缺少采购订单信息: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}`);
                }
            }
        }
        
        return mappings;
    }

    buildUpdateData(businessDataList, mptStepConfig) {
        const firstBusinessData = businessDataList[0];
        const updateData = {};

        // 只有当字段有值时才添加到更新对象中
        if (firstBusinessData.SupplyingPlant) {
            updateData.SupplyingPlant = firstBusinessData.SupplyingPlant;
        }
        if (firstBusinessData.PurchaseOrderDate) {
            updateData.PurchaseOrderDate = firstBusinessData.PurchaseOrderDate;
        }
        if (firstBusinessData.DocumentCurrency) {
            updateData.DocumentCurrency = firstBusinessData.DocumentCurrency;
        }

        return updateData;
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

module.exports = PurchaseOrderHeaderUpdateService;