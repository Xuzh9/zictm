const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class InboundDeliveryPutawayService {
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

            console.log('[InboundDeliveryPutawayService] 开始执行, zrfcid:', zrfcid, 'canum:', canum, 'zdfjy:', zdfjy);

            // 读取 ProcessConfig 表获取业务表名（使用业务表1）
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid, true);
            if (!businessTable) {
                const returnResult = {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
                console.log('[InboundDeliveryPutawayService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }
            console.log('[InboundDeliveryPutawayService] 业务表名:', businessTable);

            // 读取业务表数据
            const businessDataResult = await this.getBusinessData(businessTable, zrfcLogid);
            if (businessDataResult.code === 'E') {
                const returnResult = {
                    code: 'E',
                    message: businessDataResult.message,
                    objkey: ''
                };
                console.log('[InboundDeliveryPutawayService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

            const businessDataList = businessDataResult.businessData;
            console.log('[InboundDeliveryPutawayService] 业务数据条数:', businessDataList.length);

            // 使用通用工具类读取之前步骤的 objkey（交货单号）
            let deliveryDocument = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                deliveryDocument = previousObjkey;
            }

            if (!deliveryDocument) {
                const returnResult = {
                    code: 'E',
                    message: '未找到交货单号',
                    objkey: ''
                };
                console.log('[InboundDeliveryPutawayService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }
            console.log('[InboundDeliveryPutawayService] 交货单号:', deliveryDocument);

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);
            console.log('[InboundDeliveryPutawayService] MPTStepConfig:', JSON.stringify(mptStepConfig));

            const apiPath = '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002';

            // 获取 CSRF token
            const csrfUrl = `${apiPath}/A_InbDeliveryHeader('${deliveryDocument}')`;
            console.log('[InboundDeliveryPutawayService] 获取 CSRF token URL:', csrfUrl);

            const csrfResult = await executeHttpRequest(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'GET',
                    url: csrfUrl,
                    headers: {
                        'X-CSRF-Token': 'Fetch',
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            // 提取 cookie、CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];
            console.log('[InboundDeliveryPutawayService] CSRF token:', csrfToken ? '获取成功' : '获取失败');

            // 循环处理每个行项目
            for (const businessData of businessDataList) {
                const deliveryDocumentItem = businessData.SalesOrderItem || businessData.DeliveryDocumentItem || '';

                if (!deliveryDocumentItem) {
                    console.warn('[InboundDeliveryPutawayService] 跳过空行项目');
                    continue;
                }

                console.log('[InboundDeliveryPutawayService] 处理行项目:', deliveryDocumentItem);

                // 获取行项目的 ETag
                const itemEtagUrl = `${apiPath}/A_InbDeliveryItem(DeliveryDocument='${deliveryDocument}',DeliveryDocumentItem='${deliveryDocumentItem}')`;
                let itemEtag; 
                try {
                    const itemEtagResult = await executeHttpRequest(
                        {
                            destinationName: this.commonUtils.getDestinationName()
                        },
                        {
                            method: 'GET',
                            url: itemEtagUrl,
                            headers: {
                                'Accept': 'application/json',
                                'Cookie': cookieString,
                                'sap-language': 'ZH'
                            },
                            validateStatus: function (status) {
                                return true;
                            }
                        }
                    );

                    if (itemEtagResult.status >= 200 && itemEtagResult.status < 300) {
                        itemEtag = itemEtagResult.headers['etag'] || itemEtagResult.headers['Etag'] || itemEtagResult.headers['ETag'];
                        console.log('[InboundDeliveryPutawayService] 获取行项目 ETag 成功:', deliveryDocumentItem);
                    } else {
                        console.warn('[InboundDeliveryPutawayService] 获取行项目 ETag 失败:', deliveryDocumentItem);
                    }
                } catch (error) {
                    console.warn('[InboundDeliveryPutawayService] 获取行项目 ETag 异常:', deliveryDocumentItem, error.message);
                }

                // 构建 PutawayOneItem API URL (通过查询参数方式)
                const putawayUrl = `${apiPath}/PutawayOneItem?DeliveryDocument='${deliveryDocument}'&DeliveryDocumentItem='${deliveryDocumentItem}'`;
                console.log('[InboundDeliveryPutawayService] 上架API地址:', putawayUrl);

                // 构建请求头
                const requestHeaders = {
                    'X-CSRF-Token': csrfToken,
                    'Accept': 'application/json',
                    'Cookie': cookieString,
                    'sap-language': 'ZH',
                    'If-Match': itemEtag || '*'
                };

                // 调用 PutawayOneItem API
                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'POST',
                        url: putawayUrl,
                        headers: requestHeaders,
                        validateStatus: function (status) {
                            return true;
                        }
                    }
                );

                console.log('[InboundDeliveryPutawayService] 状态码:', result.status);

                if (result.status >= 200 && result.status < 300) {
                    console.log('[InboundDeliveryPutawayService] 行项目入库更新成功:', deliveryDocumentItem);
                } else {
                    const errorMessage = this.parseError(result.data);
                    console.error('[InboundDeliveryPutawayService] 行项目入库更新失败:', deliveryDocumentItem, errorMessage);
                    console.error('[InboundDeliveryPutawayService] 完整错误数据:', JSON.stringify(result.data));
                    const returnResult = {
                        code: 'E',
                        message: `行项目 ${deliveryDocumentItem} 入库更新: ${errorMessage}`,
                        objkey: deliveryDocument
                    };
                    return returnResult;
                }
            }

            const returnResult = {
                code: 'S',
                message: '内向交货单入库数量更新成功',
                objkey: deliveryDocument
            };
            console.log('[InboundDeliveryPutawayService] 返回结果:', JSON.stringify(returnResult));
            return returnResult;

        } catch (error) {
            console.error('[InboundDeliveryPutawayService] 执行失败:', error);
            return {
                code: 'E',
                message: `内向交货单入库数量更新失败: ${error.message}`,
                objkey: ''
            };
        }
    }

    async getBusinessData(businessTable, zrfcLogid) {
        try {
            const entity = cds.entities[`com.sap.zictm.${businessTable}`];
            if (!entity) {
                return { code: 'E', message: `业务表 ${businessTable} 不存在` };
            }

            const businessData = await cds.run(
                SELECT.from(entity)
                    .where({ zrfc_logid: zrfcLogid })
            );

            if (!businessData || businessData.length === 0) {
                return { code: 'E', message: `未找到业务数据，zrfcLogid: ${zrfcLogid}` };
            }

            return { code: 'S', businessData: businessData };
        } catch (error) {
            console.error('[InboundDeliveryPutawayService.getBusinessData] 获取业务数据失败:', error);
            return { code: 'E', message: `获取业务数据失败: ${error.message}` };
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

        if (errorData.error && errorData.error.message && errorData.error.message.value) {
            return errorData.error.message.value;
        } else if (errorData.error && errorData.error.message) {
            return errorData.error.message;
        } else if (errorData.error && errorData.error.innererror && errorData.error.innererror.ERRORDETAILS) {
            const details = errorData.error.innererror.ERRORDETAILS;
            if (Array.isArray(details) && details.length > 0) {
                return details[0].Message || JSON.stringify(details[0]);
            }
        }

        return JSON.stringify(errorData);
    }
}

module.exports = InboundDeliveryPutawayService;