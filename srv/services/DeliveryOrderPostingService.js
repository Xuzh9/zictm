const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const CommonUtils = require('../handlers/CommonUtils');

// 简单的延迟函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class DeliveryOrderPostingService {
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

            // 读取 ProcessConfig 表获取业务表名
            const businessTable = await this.getBusinessTable(zrfcid);
            if (!businessTable) {
                const returnResult = {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
                console.log('[DeliveryOrderPostingService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }
            console.log('[DeliveryOrderPostingService] 业务表名:', businessTable);

            // 读取业务表数据
            const businessDataResult = await this.getBusinessData(businessTable, zrfcLogid);
            if (businessDataResult.code === 'E') {
                const returnResult = {
                    code: 'E',
                    message: businessDataResult.message,
                    objkey: ''
                };
                console.log('[DeliveryOrderPostingService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

            const businessDataList = businessDataResult.businessData;
            const mainData = businessDataList[0];

            // 使用通用工具类读取之前步骤的 objkey（交货单号）
            let deliveryDocument = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                deliveryDocument = previousObjkey;
            }

            // 获取销售订单类型（SD07/SD10 从 PIDeliveryRel 获取，其他从业务表获取）
            let salesOrderType;
            if ((zrfcid === 'SD07' && canum === 100) || (zrfcid === 'SD10' && (canum === 100 ))) {
                try {
                    const PIDeliveryRel = cds.entities['com.sap.zictm.PIDeliveryRel'];
                    const { SELECT } = cds.ql;
                    const piDeliveryRel = await cds.run(
                        SELECT.from(PIDeliveryRel)
                            .columns(['SalesOrderType'])
                            .where({
                                DeliveryDocument: mainData.DeliveryDocument,
                                DeliveryDocumentItem: mainData.DeliveryDocumentItem
                            })
                            .limit(1)
                    );
                    if (piDeliveryRel && piDeliveryRel.length > 0) {
                        salesOrderType = piDeliveryRel[0].SalesOrderType;
                    }
                } catch (error) {
                    console.error('[DeliveryOrderPostingService] 查询 PIDeliveryRel 失败:', error);
                }
            } else {
                salesOrderType = mainData.SalesOrderType;
            }

            // 借贷项订单（CR/DR）不需要交货单操作，直接跳过
            if (salesOrderType === 'CR' || salesOrderType === 'DR') {
                console.log(`[DeliveryOrderPostingService] 销售订单类型 ${salesOrderType} 为借贷项订单，步骤跳过`);
                const returnResult = {
                    code: 'S',
                    message: `销售订单类型 ${salesOrderType} 为借贷项订单，跳过交货单过账`,
                    objkey: ''
                };
                console.log('[DeliveryOrderPostingService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

            // 检查交货单号是否存在
            if (!deliveryDocument) {
                const returnResult = {
                    code: 'E',
                    message: '交货单号为空，无法执行过账',
                    objkey: ''
                };
                console.log('[DeliveryOrderPostingService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }
            
            console.log(`[DeliveryOrderPostingService] 销售订单类型: ${salesOrderType}`);
            console.log(`[DeliveryOrderPostingService] 开始执行交货单过账, 交货单号: ${deliveryDocument}`);
            console.log(`[DeliveryOrderPostingService] 判断条件 - zrfcid: ${zrfcid}, canum: ${canum}, 类型 - zrfcid: ${typeof zrfcid}, canum: ${typeof canum}`);

            // 根据订单类型获取 API 配置
            const apiConfig = this.getApiConfig(salesOrderType, zrfcid, canum);

            // 构建获取 CSRF token 和 ETag 的 URL（包含具体交货单号）
            const csrfUrl = apiConfig.csrfUrl.replace('{DeliveryDocument}', deliveryDocument);
            console.log(`[DeliveryOrderPostingService] 获取 CSRF token URL: ${csrfUrl}`);

            // 获取 CSRF token（同时获取 ETag）
            const csrfResult = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'GET',
                    url: csrfUrl,
                    headers: {
                        'X-CSRF-Token': 'Fetch'
                    }
                }
            );

            // 提取 cookie、CSRF token 和 ETag
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];
            const etag = csrfResult.headers['etag'] || csrfResult.headers['Etag'] || csrfResult.headers['ETag'];

            // 构建过账 API URL（将交货单号附加到 URL 后面）
            const postingUrl = `${apiConfig.postingUrl}'${deliveryDocument}'`;
            console.log(`[DeliveryOrderPostingService] 过账 API 地址: ${postingUrl}`);

            // 构建请求头（包含 ETag）
            const requestHeaders = {
                'X-CSRF-Token': csrfToken,
                'Accept': 'application/json',
                'Cookie': cookieString,
                'sap-language': 'ZH'
            };
            // 添加 If-Match 头（如果获取到 ETag 则使用，否则使用 *）
            requestHeaders['If-Match'] = etag || '*';

            // 打印请求信息
            console.log(`[DeliveryOrderPostingService] 过账请求 - 交货单号: ${deliveryDocument}`);
            console.log(`[DeliveryOrderPostingService] 请求头:`, requestHeaders);
            
            // 调用交货单过账 API（带锁定重试机制）
            const result = await this.executePostingWithRetry(postingUrl, requestHeaders, deliveryDocument);

            console.log('交货单过账状态码:', result.status);

            if (result.status >= 200 && result.status < 300) {
                const responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;

                // 提取过账结果信息
                let message = '交货单过账成功';
                if (responseData?.d?.PostingConfirmation) {
                    const confirmation = responseData.d.PostingConfirmation;
                    if (confirmation.MaterialDocument) {
                        message = `${message}，物料凭证号: ${confirmation.MaterialDocument}`;
                    }
                }

                console.log(message);

                const returnResult = {
                    code: 'S',
                    message: message,
                    objkey: deliveryDocument
                };
                console.log('[DeliveryOrderPostingService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            } else {
                const errorMessage = this.parseError(result.data);
                console.error('交货单过账失败:', errorMessage);
                console.error('交货单过账失败 - 完整错误数据:', JSON.stringify(result.data));
                const returnResult = {
                    code: 'E',
                    message: errorMessage,
                    objkey: deliveryDocument
                };
                console.log('[DeliveryOrderPostingService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

        } catch (error) {
            console.error('DeliveryOrderPostingService 执行失败:', error);
            const returnResult = {
                code: 'E',
                message: error.message || '交货单过账失败',
                objkey: ''
            };
            console.log('[DeliveryOrderPostingService] 返回结果:', JSON.stringify(returnResult));
            return returnResult;
        }
    }

    /**
     * 获取业务表名
     * @param {string} zrfcid - 业务流程ID
     * @returns {Promise<string|null>} 业务表名
     */
    async getBusinessTable(zrfcid) {
        try {
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const config = await cds.run(
                SELECT.one.from(ProcessConfig)
                    .where({ zrfcid: zrfcid })
            );
            if (config && config.businessTable1) {
                return config.businessTable1;
            }
            return null;
        } catch (error) {
            console.error('[DeliveryOrderPostingService.getBusinessTable] 获取业务表名失败:', error);
            return null;
        }
    }

    /**
     * 获取业务数据
     * @param {string} businessTable - 业务表名
     * @param {string} zrfcLogid - 多步ID
     * @returns {Promise<Object>} 业务数据
     */
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
            console.error('[DeliveryOrderPostingService.getBusinessData] 获取业务数据失败:', error);
            return { code: 'E', message: `获取业务数据失败: ${error.message}` };
        }
    }

    /**
     * 带锁定重试机制的过账调用
     * @param {string} postingUrl - 过账API地址
     * @param {Object} requestHeaders - 请求头
     * @param {string} deliveryDocument - 交货单号
     * @param {number} maxRetries - 最大重试次数（默认5次）
     * @param {number} initialDelay - 初始延迟毫秒（默认1000ms）
     * @returns {Promise<Object>} 过账结果
     */
    async executePostingWithRetry(postingUrl, requestHeaders, deliveryDocument, maxRetries = 5, initialDelay = 1000) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[DeliveryOrderPostingService] 执行过账尝试 ${attempt}/${maxRetries}, 交货单号: ${deliveryDocument}`);
                
                const result = await this.commonUtils.executeHttpRequestWithRetry(
                    {
                        destinationName: this.commonUtils.getDestinationName()
                    },
                    {
                        method: 'POST',
                        url: postingUrl,
                        headers: requestHeaders,
                        validateStatus: function (status) {
                            return true;
                        }
                    }
                );
                
                // 检查是否是锁定相关错误
                if (result.status >= 400) {
                    const errorMessage = this.parseError(result.data);
                    // 检测 SAP 锁定错误模式（sap-language已设置为ZH，只判断中文错误信息）
                    const isLockError = errorMessage.includes('锁定') || 
                                       errorMessage.includes('正在处理') ||
                                       errorMessage.includes('另一个用户') ||
                                       errorMessage.includes('锁定条目');
                    
                    if (isLockError) {
                        throw new Error(`锁定错误: ${errorMessage}`);
                    }
                }
                
                return result;
                
            } catch (error) {
                lastError = error;
                
                // 检查是否是锁定相关错误（sap-language已设置为ZH，只判断中文错误信息）
                const errorMsg = error.message || '';
                const isLockError = errorMsg.includes('锁定') || 
                                   errorMsg.includes('正在处理') ||
                                   errorMsg.includes('另一个用户') ||
                                   errorMsg.includes('锁定条目');
                
                if (isLockError && attempt < maxRetries) {
                    const delay = initialDelay * Math.pow(2, attempt - 1); // 指数退避
                    console.warn(`[DeliveryOrderPostingService] 交货单 ${deliveryDocument} 被锁定，等待 ${delay}ms 后重试 (尝试 ${attempt}/${maxRetries})`);
                    await sleep(delay);
                    continue;
                }
                
                // 非锁定错误或已达到最大重试次数，抛出错误
                throw error;
            }
        }
        
        throw lastError || new Error(`交货单 ${deliveryDocument} 过账失败，已重试 ${maxRetries} 次`);
    }

    /**
     * 根据订单类型获取 API 配置
     * @param {string} salesOrderType - 销售订单类型
     * @param {string} zrfcid - 业务流程ID
     * @param {number} canum - 步骤编号
     * @returns {Object} API 配置
     */
    getApiConfig(salesOrderType, zrfcid, canum) {
        console.log(`[DeliveryOrderPostingService.getApiConfig] 入参 - salesOrderType: ${salesOrderType}, zrfcid: ${zrfcid}, canum: ${canum}, 类型 - zrfcid: ${typeof zrfcid}, canum: ${typeof canum}`);
        if ((zrfcid === 'SD04' && canum === 140) ||
            (zrfcid === 'SD07' && canum === 50) ||
            zrfcid === 'SD09' ||
            (zrfcid === 'SD10' && (canum === 50 || canum === 150)) ||
            (zrfcid === 'SD11' && canum === 180)) {
            // 内向交货单过账API
            return {
                csrfUrl: '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002/A_InbDeliveryHeader(\'{DeliveryDocument}\')',
                postingUrl: '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002/PostGoodsReceipt?DeliveryDocument='
            };
        } else if (((zrfcid === 'SD11' && canum === 90) || (zrfcid === 'SD07' && (canum === 80 || canum === 90)) || (zrfcid === 'SD10' && canum === 90)) && salesOrderType === 'CBRE') {
            // 退货交货单过账API    
            return {
                csrfUrl: '/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=2/A_ReturnsDeliveryHeader(\'{DeliveryDocument}\')',
                postingUrl: '/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=2/PostGoodsReceipt?DeliveryDocument='
            };
        } else {
            // 外向交货单过账API
            return {
                csrfUrl: '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader(\'{DeliveryDocument}\')',
                postingUrl: '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/PostGoodsIssue?DeliveryDocument='
            };
        }
    }

    /**
     * 解析错误信息
     * @param {Object|string} errorData - 错误数据
     * @returns {string} 错误消息
     */
    parseError(errorData) {
        if (!errorData) return '未知错误';

        if (typeof errorData === 'string') {
            try {
                errorData = JSON.parse(errorData);
            } catch (e) {
                return errorData;
            }
        }

        let errorMessage = '';
        if (errorData?.error?.innererror?.errordetails && errorData.error.innererror.errordetails.length > 0) {
            const details = errorData.error.innererror.errordetails;
            const messages = details.map(d => d.code ? `${d.code}: ${d.message}` : d.message).filter(m => m);
            errorMessage = messages.join('; ');
        }

        if (!errorMessage) {
            if (errorData?.error?.message?.value) {
                errorMessage = errorData.error.message.value;
            } else if (errorData?.error?.message) {
                errorMessage = errorData.error.message;
            } else if (errorData?.message) {
                errorMessage = errorData.message;
            } else {
                errorMessage = JSON.stringify(errorData);
            }
        }

        return errorMessage;
    }
}

module.exports = DeliveryOrderPostingService;