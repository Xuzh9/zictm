const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class DeliveryOrderCreateService {
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

            // 使用通用工具类读取之前步骤的 objkey（销售订单号）
            let sourceDocument = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                sourceDocument = previousObjkey;
            }

            // 读取 ProcessConfig 表获取业务表名（使用业务表1）
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid, true);
            if (!businessTable) {
                const returnResult = {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
                console.log('[DeliveryOrderCreateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

            // 读取业务表数据（使用 zrfc_logid 查询）
            const businessDataList = await this.commonUtils.getBusinessData(businessTable, zrfcLogid, 'zrfc_logid');
            if (!businessDataList || businessDataList.length === 0) {
                const returnResult = {
                    code: 'E',
                    message: `未找到业务数据，源文档: ${sourceDocument}`,
                    objkey: ''
                };
                console.log('[DeliveryOrderCreateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 获取销售订单类型（从第一条业务数据获取）
            const salesOrderType = businessDataList[0]?.SalesOrderType;
            
            // 借贷项订单（CR/DR）不需要生成交货单，直接跳过
            if (salesOrderType === 'CR' || salesOrderType === 'DR') {
                console.log(`销售订单类型 ${salesOrderType} 为借贷项订单，步骤跳过`);
                const returnResult = {
                    code: 'S',
                    message: `销售订单类型 ${salesOrderType} 为借贷项订单，跳过交货单创建`,
                    objkey: ''
                };
                console.log('[DeliveryOrderCreateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }
            
            // 根据销售订单类型获取 API 配置
            const apiConfig = this.getApiConfig(salesOrderType);
            
            console.log(`销售订单类型: ${salesOrderType}, API配置:`, apiConfig);

            // 获取 CSRF token（使用对应的 API 服务）
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: apiConfig.csrfUrl,
                    headers: {
                        'X-CSRF-Token': 'Fetch'
                    }
                }
            );

            // 提取 cookie 和 CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];

            // 构建交货单创建数据（传入整个 businessDataList 数组，一次性创建一张交货单）
            const deliveryOrderData = await this.buildDeliveryOrderData(businessDataList, mptStepConfig, zrfcid, canum, salesOrderType, sourceDocument);
            
            console.log('交货单数据:', JSON.stringify(deliveryOrderData, null, 2));

            // 调用交货单创建 API（一次性创建一张交货单，含所有行项目）
            const result = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'POST',
                    url: apiConfig.createUrl,
                    data: deliveryOrderData,
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        'Content-Type': 'application/json',
                        'Cookie': cookieString,
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            console.log('创建交货单状态码:', result.status);

            if (result.status >= 200 && result.status < 300) {
                const responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
                const deliveryDocument = responseData?.d?.[apiConfig.responseField] || '';
                
                console.log('交货单创建成功:', deliveryDocument);
                
                const returnResult = {
                    code: 'S',
                    message: '交货单创建成功',
                    objkey: deliveryDocument
                };
                console.log('[DeliveryOrderCreateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            } else {
                const errorMessage = this.parseError(result.data);
                console.error('交货单创建失败:', errorMessage);
                const returnResult = {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
                console.log('[DeliveryOrderCreateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

        } catch (error) {
            console.error('DeliveryOrderCreateService 执行失败:', error);
            const returnResult = {
                code: 'E',
                message: error.message || '交货单创建失败',
                objkey: ''
            };
            console.log('[DeliveryOrderCreateService] 返回结果:', JSON.stringify(returnResult));
            return returnResult;
        }
    }

    /**
     * 根据销售订单类型获取 API 配置
     * @param {string} salesOrderType - 销售订单类型
     * @returns {Object} API 配置对象
     */
    getApiConfig(salesOrderType) {
        switch (salesOrderType) {
            case 'CBRE':
                // CBRE 退货订单
                return {
                    csrfUrl: '/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=0002/',
                    createUrl: '/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=0002/A_ReturnsDeliveryHeader',
                    responseField: 'ReturnsDeliveryDocument'
                };
            case 'ZPR':
            default:
                // ZOR 标准外向交货单
                return {
                    csrfUrl: '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/',
                    createUrl: '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader',
                    responseField: 'DeliveryDocument'
                };
        }
    }

    /**
     * 构建交货单创建数据
     * @param {Object} businessData - 单行业务数据
     * @param {Object} mptStepConfig - MPTStepConfig 配置
     * @param {string} zrfcid - 业务流程ID
     * @param {string} salesOrderType - 销售订单类型
     * @param {string} sourceDocument - 上一步的 objkey（销售订单号）
     * @returns {Object} 交货单创建数据
     */
    async buildDeliveryOrderData(businessDataList, mptStepConfig, zrfcid, canum, salesOrderType, sourceDocument) {
        // 构建行项目
        const deliveryItems = businessDataList.map((item) => {
            // SD02、SD04 使用 SalesOrderItem，其他使用 PIOrderItem
            const referenceItem = (zrfcid === 'SD02' || zrfcid === 'SD04') 
                ? item.SalesOrderItem 
                : item.PIOrderItem;
            
            // SD04 且 canum = 50 (STO) 使用 5 位数，其他情况使用 6 位数
            const digitCount = (zrfcid === 'SD04' && canum === 50) ? 5 : 6;
            
            return {
                ReferenceSDDocument: sourceDocument,
                ReferenceSDDocumentItem: this.padLeft(referenceItem, digitCount, '0')
            };
        });

        // 构建基本数据
        const deliveryOrderData = {
            to_DeliveryDocumentItem: {
                results: deliveryItems
            }
        };

        return deliveryOrderData;
    }

    /**
     * 将交货单号更新到 PIDeliveryRel 表
     * @param {string} deliveryDocument - 交货单号
     * @param {Object} businessData - 业务数据
     */
    async updatePIDeliveryRel(deliveryDocument, businessData) {
        try {
            const PIDeliveryRel = cds.entities['com.sap.zictm.PIDeliveryRel'];
            const { INSERT, UPDATE } = cds.ql;
            
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = businessData.PIOrderItem || '';
            const deliveryItem = businessData.DeliveryItem || '00010';
            
            console.log(`[updatePIDeliveryRel] 开始更新 PIDeliveryRel, piOrder=${piOrder}, piOrderItem=${piOrderItem}, deliveryDocument=${deliveryDocument}, deliveryItem=${deliveryItem}`);
            
            if (piOrder && piOrderItem && deliveryDocument) {
                // 先尝试更新
                const updateResult = await cds.run(
                    UPDATE(PIDeliveryRel)
                        .set({ DeliveryNo1: deliveryDocument, DeliveryNoItem1: deliveryItem })
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                console.log(`[updatePIDeliveryRel] 更新结果:`, updateResult);
                
                // 如果没有更新到数据（表中没有该记录），则插入新记录
                if (updateResult?.affectedRows === 0 || !updateResult) {
                    console.log(`[updatePIDeliveryRel] 更新未影响任何行，尝试插入新记录`);
                    await cds.run(
                        INSERT.into(PIDeliveryRel).entries({
                            zrfc_logid: this.zrfcLogid,
                            PIOrder: piOrder,
                            PIOrderItem: piOrderItem,
                            DeliveryNo1: deliveryDocument,
                            DeliveryNoItem1: deliveryItem
                        })
                    );
                    console.log(`PIDeliveryRel 插入成功: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}, DeliveryNo1=${deliveryDocument}, DeliveryNoItem1=${deliveryItem}`);
                } else {
                    console.log(`PIDeliveryRel 更新成功: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}, DeliveryNo1=${deliveryDocument}, DeliveryNoItem1=${deliveryItem}`);
                }
            }
        } catch (error) {
            console.error(`PIDeliveryRel 更新/插入失败:`, error);
        }
    }

    /**
     * 格式化日期为 SAP OData 格式（/Date(timestamp)/）
     * @param {string|Date} dateValue - 日期值
     * @returns {string} 格式化后的日期字符串
     */
    formatDateForSAP(dateValue) {
        let dateObj;
        if (dateValue) {
            dateObj = new Date(dateValue);
        } else {
            dateObj = new Date();
        }
        
        // 格式：/Date(timestamp)/
        return `/Date(${dateObj.getTime()})/`;
    }

    /**
     * 左补齐字符串
     * @param {string|number} str - 待补齐的字符串或数字
     * @param {number} length - 目标长度
     * @param {string} padStr - 补齐字符
     * @returns {string} 补齐后的字符串
     */
    padLeft(str, length, padStr) {
        if (!str) return '';
        return String(str).padStart(length, padStr);
    }

    /**
     * 解析错误信息
     * @param {Object|string} errorData - 错误数据
     * @returns {string} 错误信息
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

module.exports = DeliveryOrderCreateService;