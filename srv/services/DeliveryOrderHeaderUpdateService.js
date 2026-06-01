const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class DeliveryOrderHeaderUpdateService {
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
                console.log('[DeliveryOrderUpdateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }
            console.log('[DeliveryOrderUpdateService] 业务表名:', businessTable);

            // 读取业务表数据
            const businessDataResult = await this.getBusinessData(businessTable, zrfcLogid);
            if (businessDataResult.code === 'E') {
                const returnResult = {
                    code: 'E',
                    message: businessDataResult.message,
                    objkey: ''
                };
                console.log('[DeliveryOrderUpdateService] 返回结果:', JSON.stringify(returnResult));
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

            // 检查交货单号是否存在
            if (!deliveryDocument) {
                const returnResult = {
                    code: 'E',
                    message: '交货单号为空，无法执行修改',
                    objkey: ''
                };
                console.log('[DeliveryOrderUpdateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

            // 获取销售订单类型（SD07/SD10 从 PIDeliveryRel 获取，其他从业务表获取）
            let salesOrderType;
            if ((zrfcid === 'SD07' && canum === 70) || (zrfcid === 'SD10' && canum === 120)) {
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
                    console.error('[DeliveryOrderUpdateService] 查询 PIDeliveryRel 失败:', error);
                }
            } else {
                salesOrderType = mainData.SalesOrderType;
            }
            console.log(`[DeliveryOrderUpdateService] 销售订单类型: ${salesOrderType}`);

            // 获取 DeliveryDate
            const deliveryDate = mainData.DeliveryDate || mainData.ActualGoodsMovementDate;
            if (!deliveryDate) {
                const returnResult = {
                    code: 'E',
                    message: 'DeliveryDate 为空，无法设置 ActualGoodsMovementDate',
                    objkey: deliveryDocument
                };
                console.log('[DeliveryOrderUpdateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

            console.log(`[DeliveryOrderUpdateService] 开始修改交货单, 交货单号: ${deliveryDocument}, ActualGoodsMovementDate: ${deliveryDate}`);

            // 根据 zrfcid、canum 和订单类型获取 API 配置
            const apiConfig = this.getApiConfig(zrfcid, canum, salesOrderType);

            // 构建获取 CSRF token 和 ETag 的 URL（包含具体交货单号）
            const csrfUrl = apiConfig.csrfUrl.replace('{DeliveryDocument}', deliveryDocument);
            console.log(`[DeliveryOrderUpdateService] 获取 CSRF token URL: ${csrfUrl}`);

            // 获取 CSRF token（同时获取 ETag）
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
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

            // 构建请求体
            const updateData = this.buildUpdateData(deliveryDate);

            console.log('交货单修改数据:', JSON.stringify(updateData, null, 2));

            // 构建修改 API URL
            const updateUrl = apiConfig.updateUrl.replace('{DeliveryDocument}', deliveryDocument);
            console.log(`[DeliveryOrderUpdateService] 修改 API 地址: ${updateUrl}`);

            // 构建请求头
            const requestHeaders = {
                'X-CSRF-Token': csrfToken,
                'Accept': 'application/json',
                'Cookie': cookieString,
                'sap-language': 'ZH',
                'If-Match': etag || '*'
            };

            // 调用交货单修改 API
            const result = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'PATCH',
                    url: updateUrl,
                    data: updateData,
                    headers: requestHeaders,
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            console.log('交货单修改状态码:', result.status);

            if (result.status >= 200 && result.status < 300) {
                console.log('交货单修改成功');
                
                const returnResult = {
                    code: 'S',
                    message: '交货单修改成功',
                    objkey: deliveryDocument
                };
                console.log('[DeliveryOrderUpdateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            } else {
                const errorMessage = this.parseError(result.data);
                console.error('交货单修改失败:', errorMessage);
                const returnResult = {
                    code: 'E',
                    message: errorMessage,
                    objkey: deliveryDocument
                };
                console.log('[DeliveryOrderUpdateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

        } catch (error) {
            console.error('DeliveryOrderUpdateService 执行失败:', error);
            const returnResult = {
                code: 'E',
                message: error.message || '交货单修改失败',
                objkey: ''
            };
            console.log('[DeliveryOrderUpdateService] 返回结果:', JSON.stringify(returnResult));
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
            console.error('[DeliveryOrderUpdateService.getBusinessTable] 获取业务表名失败:', error);
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
            console.error('[DeliveryOrderUpdateService.getBusinessData] 获取业务数据失败:', error);
            return { code: 'E', message: `获取业务数据失败: ${error.message}` };
        } 
    }

    /**
     * 根据 zrfcid、canum 和订单类型获取 API 配置
     * @param {string} zrfcid - 业务流程ID
     * @param {number} canum - 步骤号
     * @param {string} salesOrderType - 销售订单类型
     * @returns {Object} API 配置
     */
    getApiConfig(zrfcid, canum, salesOrderType) {
        // 根据 zrfcid 和 canum 获取对应的 API 配置
        if ((zrfcid === 'SD04' && canum === 100) || 
            (zrfcid === 'SD07' && canum === 20) || 
            zrfcid === 'SD09' || 
            (zrfcid === 'SD10' && (canum === 20 || canum === 120))) {
            //内向交货单 API
            return {
                csrfUrl: '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002/A_InbDeliveryHeader(\'{DeliveryDocument}\')',
                updateUrl: "/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002/A_InbDeliveryHeader('{DeliveryDocument}')"
            };
        } else if (((zrfcid === 'SD04' && canum === 150) || (zrfcid === 'SD07' && canum === 60) ) && salesOrderType === 'CBRE') {
            //退货交货单 API
            return {
                csrfUrl: '/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=2/A_ReturnsDeliveryHeader(\'{DeliveryDocument}\')',
                updateUrl: "/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=2/A_ReturnsDeliveryHeader(DeliveryDocument='{DeliveryDocument}')"
            };
        } else {
            //外向交货单 API
            return {
                csrfUrl: '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader(\'{DeliveryDocument}\')',
                updateUrl: "/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader('{DeliveryDocument}')"
            };
        }
    }

    /**
     * 构建修改数据
     * @param {string} deliveryDate - 交货日期
     * @returns {Object} 修改数据
     */
    buildUpdateData(deliveryDate) {
        return {
            ActualGoodsMovementDate: this.convertDate(deliveryDate),
            YY1_FD_SPZT_DLH: '1'
        };
    }

    /**
     * 转换日期格式为 SAP OData 格式
     * @param {string} dateStr - 日期字符串
     * @returns {string} OData 日期格式
     */
    convertDate(dateStr) {
        if (!dateStr) return null;
        
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            return null;
        }
        
        // 转换为 /Date(timestamp)/ 格式
        const timestamp = date.getTime();
        return `/Date(${timestamp})/`;
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

module.exports = DeliveryOrderHeaderUpdateService;
