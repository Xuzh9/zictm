const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class DeliveryOrderItemUpdateService {
    constructor() {
        this.zrfcLogid = null;
        this.zrfcid = null;
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

            console.log('[DeliveryOrderItemUpdateService] 开始执行, zrfcid:', zrfcid, 'canum:', canum, 'zdfjy:', zdfjy);

            // 读取 ProcessConfig 表获取业务表名（使用业务表1）
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid, true);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }
            console.log('[DeliveryOrderItemUpdateService] 业务表名:', businessTable);

            // 读取业务表数据（使用 zrfc_logid 查询）
            const businessDataList = await this.commonUtils.getBusinessData(businessTable, zrfcLogid, 'zrfc_logid');
            if (!businessDataList || businessDataList.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据，zrfc_logid: ${zrfcLogid}`,
                    objkey: ''
                };
            }
           
            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 使用通用工具类读取之前步骤的 objkey（交货单号）
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);

            // 获取交货单号（从 objkey 或业务数据中获取）
            const deliveryDocument = previousObjkey || businessDataList[0]?.DeliveryDocument || '';
            if (!deliveryDocument) {
                return {
                    code: 'E',
                    message: '未找到交货单号',
                    objkey: ''
                };
            }
            console.log('[DeliveryOrderItemUpdateService] 交货单号:', deliveryDocument);

            // 获取销售订单类型（从第一条业务数据获取）
            const salesOrderType = businessDataList[0]?.SalesOrderType;
            
            // 根据 zrfcid、canum 和销售订单类型判断使用的 API 路径
            let apiPath;
            let itemEntity;
            
            if (zrfcid === 'SD04' && canum === 110) {
                apiPath = '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002';
                itemEntity = 'A_InbDeliveryItem';
            } else if (((zrfcid === 'SD04' && canum === 160) || (zrfcid === 'SD07' && canum === 70)) && salesOrderType === 'CBRE') {
                apiPath = '/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=2';
                itemEntity = 'A_ReturnsDeliveryItem';
            } else {
                apiPath = '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002';
                itemEntity = 'A_OutbDeliveryItem';
            }
            console.log('[DeliveryOrderItemUpdateService] API 路径:', apiPath, '实体:', itemEntity);

            let csrfToken = null;
            let cookieString = null;

            // 循环更新每个行项目
            for (const businessData of businessDataList) {
                const deliveryDocumentItem = businessData.SalesOrderItem || businessData.DeliveryDocumentItem || '';
                
                if (!deliveryDocumentItem) {
                    console.warn('[DeliveryOrderItemUpdateService] 跳过空行项目');
                    continue;
                }

                // 构建更新 URL
                const itemUrl = `${apiPath}/${itemEntity}(DeliveryDocument='${deliveryDocument}',DeliveryDocumentItem='${deliveryDocumentItem}')`;

                // GET 获取行项目数据（同时获取 CSRF token 和 etag）
                console.log('[DeliveryOrderItemUpdateService] 获取行项目数据:', itemUrl);
                const getResult = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'GET',
                        url: itemUrl,
                        headers: {
                            'X-CSRF-Token': csrfToken ? csrfToken : 'Fetch',
                            'Cookie': cookieString,
                            'sap-language': 'ZH'
                        },
                        validateStatus: function (status) {
                            return true;
                        }
                    }
                );

                // 第一次请求时获取 CSRF token 和 cookie
                if (!csrfToken) {
                    csrfToken = getResult.headers['x-csrf-token'];
                    cookieString = getResult.headers['set-cookie'] ? getResult.headers['set-cookie'].join('; ') : '';
                    console.log('[DeliveryOrderItemUpdateService] CSRF token 获取成功:', csrfToken);
                }

                // 获取 etag（SAP OData 的 If-Match header）
                const etag = getResult.headers['etag'] || getResult.headers['Etag'];
                console.log('[DeliveryOrderItemUpdateService] 获取到 etag:', etag);

                if (getResult.status !== 200) {
                    const errorMessage = this.parseError(getResult.data);
                    console.error('[DeliveryOrderItemUpdateService] 获取行项目数据失败:', deliveryDocumentItem, errorMessage);
                    continue;
                }

                // 构建更新数据
                const updateData = {};
                
                // 更新 Batch（如果有值，否则使用默认值 '2025'）
                updateData.Batch = '2025';
                
                // 更新 StorageLocation（内向交货单不需要更新）
                if (businessData.ReceivingStorageLocation && !(zrfcid === 'SD04' && canum === 110)) {
                    updateData.StorageLocation = businessData.ReceivingStorageLocation;
                }

                // 更新 ActualDeliveryQuantity = RequestedQuantity（仅 SD04 110）
                if (zrfcid === 'SD04' && canum === 110 && businessData.RequestedQuantity) {
                    updateData.ActualDeliveryQuantity = businessData.RequestedQuantity;
                }

                if (Object.keys(updateData).length === 0) {
                    console.warn('[DeliveryOrderItemUpdateService] 没有需要更新的字段，跳过行项目:', deliveryDocumentItem);
                    continue;
                }

                console.log('[DeliveryOrderItemUpdateService] 更新数据:', JSON.stringify(updateData));

                // PATCH 更新行项目
                const patchResult = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'PATCH',
                        url: itemUrl,
                        headers: {
                            'X-CSRF-Token': csrfToken,
                            'Cookie': cookieString,
                            'Accept': 'application/json',
                            'sap-language': 'ZH',
                            'If-Match': etag || '*'
                        },
                        data: updateData,
                        validateStatus: function (status) {
                            return true;
                        }
                    }
                );

                if (patchResult.status === 204 || (patchResult.data && !patchResult.data.error)) {
                    console.log('[DeliveryOrderItemUpdateService] 行项目修改成功:', deliveryDocumentItem);
                } else {
                    const errorMessage = this.parseError(patchResult.data);
                    console.error('[DeliveryOrderItemUpdateService] 行项目修改失败:', deliveryDocumentItem, errorMessage);
                    return {
                        code: 'E',
                        message: `行项目 ${deliveryDocumentItem} 修改失败: ${errorMessage}`,
                        objkey: deliveryDocument
                    };
                }
            }

            console.log('[DeliveryOrderItemUpdateService] 交货单行项目修改成功');
            
            const returnResult = {
                code: 'S',
                message: '交货单行项目修改成功',
                objkey: deliveryDocument
            };
            console.log('[DeliveryOrderItemUpdateService] 返回结果:', JSON.stringify(returnResult));
            return returnResult;

        } catch (error) {
            console.error('[DeliveryOrderItemUpdateService] 执行失败:', error);
            return {
                code: 'E',
                message: `交货单行项目修改失败: ${error.message}`,
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

        if (errorData?.error?.message?.value) {
            return errorData.error.message.value;
        } else if (errorData?.error?.message) {
            return JSON.stringify(errorData.error.message);
        } else if (errorData?.message) {
            return errorData.message;
        } else {
            return JSON.stringify(errorData);
        }
    }
}

module.exports = DeliveryOrderItemUpdateService;