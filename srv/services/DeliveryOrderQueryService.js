const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class DeliveryOrderQueryService {
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
            let referenceSDDocument = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                referenceSDDocument = previousObjkey;
            }

            return await this.queryInboundDeliveryByReference(referenceSDDocument);

        } catch (error) {
            console.error('DeliveryOrderQueryService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '查询内向交货单失败',
                objkey: ''
            };
        }
    }

    async queryInboundDeliveryByReference(referenceSDDocument) {
        const maxRetries = 10;
        const retryDelay = 1000;

        if (!referenceSDDocument) {
            return {
                code: 'E',
                message: 'ReferenceSDDocument 不能为空',
                objkey: ''
            };
        }

        const filter = `ReferenceSDDocument eq '${referenceSDDocument}'`;
        const url = `/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002/A_InbDeliveryItem?$filter=${encodeURIComponent(filter)}&$top=1`;

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
                    const inboundDeliveries = responseData?.d?.results || [];

                    console.log(`查询内向交货单完成，ReferenceSDDocument: ${referenceSDDocument}, 数量: ${inboundDeliveries.length}`);

                    if (inboundDeliveries.length === 0) {
                        if (retryCount < maxRetries - 1) {
                            console.log(`查询内向交货单未找到数据，将在 ${retryDelay}ms 后重试（${retryCount + 1}/${maxRetries}）`);
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                            continue;
                        } else {
                            return {
                                code: 'E',
                                message: `超过最大重试次数(${maxRetries})，未找到匹配的内向交货单，ReferenceSDDocument: ${referenceSDDocument}`,
                                objkey: ''
                            };
                        }
                    }

                    return {
                        code: 'S',
                        message: '查询成功',
                        objkey: inboundDeliveries[0]?.DeliveryDocument
                    };
                } else {
                    if (retryCount < maxRetries - 1) {
                        console.log(`查询内向交货单失败，HTTP状态码: ${result.status}，将在 ${retryDelay}ms 后重试（${retryCount + 1}/${maxRetries}）`);
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
                if (retryCount < maxRetries - 1) {
                    console.log(`查询内向交货单异常: ${error.message}，将在 ${retryDelay}ms 后重试（${retryCount + 1}/${maxRetries}）`);
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

module.exports = DeliveryOrderQueryService;