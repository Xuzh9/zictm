const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class SalesOrderPricingUpdateService {
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
                    message: `未找到业务数据，销售订单号: ${salesOrder}`,
                    objkey: ''
                };
            }

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 统一查询 PISalesOrderRel 表获取所有需要的字段
            const piSalesOrderRelRecords = await this.getPISalesOrderRelRecords(businessDataList);

            // 检查是否需要跳过此步骤
            const skipResult = await this.checkSkipCondition(zrfcid, canum, piSalesOrderRelRecords);
            if (skipResult) {
                return skipResult;
            }

            // 从查询结果中获取行项目号映射
            const itemMapping = this.buildItemMappingFromRecords(businessDataList, piSalesOrderRelRecords, zrfcid, canum);

            // 根据 zrfcid 和 canum 确定需要更新的定价类型
            const pricingTypes = this.getPricingTypes(zrfcid, canum);
            console.log(`需要更新的定价类型: ${JSON.stringify(pricingTypes)}`);

            // 循环处理每个行项目
            const updateResults = [];
            let csrfToken = null;
            let cookieString = null;
            
            for (let i = 0; i < itemMapping.length; i++) {
                const mapping = itemMapping[i];
                const { salesOrder: mappingSalesOrder, purchaseOrderItem, businessData } = mapping;
                const salesOrderItem = purchaseOrderItem;

                console.log(`处理销售订单 ${mappingSalesOrder} 行项目 ${salesOrderItem}`);
                
                // 处理每种定价类型
                for (const pricingType of pricingTypes) {
                    const { conditionType, valueField, currencyField, quantityField } = pricingType;
                    const fieldValue = businessData[valueField];
                    
                    // 如果字段值为空或0，则跳过该定价类型
                    if (!fieldValue || fieldValue === 0) {
                        console.log(`字段 ${valueField} 为空或0，跳过定价类型 ${conditionType}`);
                        continue;
                    }

                    // GET 获取该行项目的指定定价元素
                    const itemPricingUrl = `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrderItem(SalesOrder='${mappingSalesOrder}',SalesOrderItem='${salesOrderItem}')/to_PricingElement?$filter=ConditionType eq '${conditionType}'`;
                    console.log('查询定价元素 URL:', itemPricingUrl);
                    
                    const pricingResult = await executeHttpRequest(
                        {
                            destinationName: 'ES_API'
                        },
                        {
                            method: 'GET',
                            url: itemPricingUrl,
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
                    
                    // 如果是第一个请求，提取 CSRF token 和 cookie
                    if (i === 0 && pricingTypes.indexOf(pricingType) === 0) {
                        const cookies = pricingResult.headers['set-cookie'] || [];
                        cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
                        csrfToken = pricingResult.headers['x-csrf-token'];
                    }
                    
                    if (pricingResult.status < 200 || pricingResult.status >= 300) {
                        console.error(`获取行项目 ${salesOrderItem} 定价元素 ${conditionType} 失败，状态码: ${pricingResult.status}`);
                        updateResults.push({
                            salesOrderItem: salesOrderItem,
                            conditionType: conditionType,
                            status: pricingResult.status,
                            success: false,
                            error: true,
                            message: `获取定价元素 ${conditionType} 失败，状态码: ${pricingResult.status}`
                        });
                        continue;
                    }
                    
                    // 解析定价元素数据
                    const pricingData = typeof pricingResult.data === 'string' ? JSON.parse(pricingResult.data) : pricingResult.data;
                    const itemElements = pricingData?.d?.results || pricingData?.value || [];
                    
                    // 找到指定的定价类型
                    const element = itemElements[0];
                    
                    if (element) {
                        // PATCH 更新现有定价元素
                        const { PricingProcedureStep, PricingProcedureCounter } = element;
                        const updateUrl = `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrderItemPrElement(SalesOrder='${mappingSalesOrder}',SalesOrderItem='${salesOrderItem}',PricingProcedureStep='${PricingProcedureStep}',PricingProcedureCounter='${PricingProcedureCounter}')`;
                        
                        console.log('更新定价元素 URL:', updateUrl);

                        // 根据定价类型构建更新数据
                        const updateData = {
                            ConditionRateValue: Number(fieldValue).toFixed(2)
                        };
                        
                        // 如果是 ZB01/ZB02/ZB03/ZB04/ZC01/ZC02/ZP00 等类型，添加额外字段
                        if (currencyField && businessData[currencyField]) {
                            updateData.ConditionCurrency = businessData[currencyField];
                        }
                        if (quantityField && businessData[quantityField]) {
                            updateData.ConditionQuantity = businessData[quantityField];
                        }
                        
                        console.log('更新数据:', JSON.stringify(updateData));

                        const result = await executeHttpRequest(
                            {
                                destinationName: 'ES_API'
                            },
                            {
                                method: 'PATCH',
                                url: updateUrl,
                                data: updateData,
                                headers: {
                                    'X-CSRF-Token': csrfToken,
                                    'Content-Type': 'application/json;charset=UTF-8',
                                    'Cookie': cookieString,
                                    'sap-language': 'ZH',
                                    'If-Match': '*'
                                },
                                validateStatus: function (status) {
                                    return true;
                                }
                            }
                        );

                        // 解析SAP返回的错误信息
                        let errorMessage = '';
                        if (result.status >= 400 && result.data) {
                            // 处理JSON格式错误
                            if (result.data?.error) {
                                errorMessage = result.data.error.message?.value || result.data.error.message || JSON.stringify(result.data.error);
                            }
                            // 处理XML格式错误（SAP API可能返回XML）
                            else if (typeof result.data === 'string' && result.data.startsWith('<?xml')) {
                                const messageMatch = result.data.match(/<message[^>]*>([^<]+)<\/message>/);
                                errorMessage = messageMatch ? messageMatch[1] : 'XML格式错误';
                            }
                            else {
                                errorMessage = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
                            }
                        }
                        
                        // 打印详细错误信息
                        if (!(result.status >= 200 && result.status < 300)) {
                            console.error(`更新定价元素失败: 行项目 ${salesOrderItem}, 定价类型 ${conditionType}, 状态码: ${result.status}, 错误信息: ${errorMessage}`);
                        }
                        
                        updateResults.push({
                            salesOrderItem: salesOrderItem,
                            conditionType: conditionType,
                            status: result.status,
                            success: result.status >= 200 && result.status < 300,
                            error: result.status >= 400,
                            message: errorMessage
                        });
                    } else {
                        // 如果找不到定价元素，记录警告但不报错
                        console.warn(`行项目 ${salesOrderItem} 未找到 ${conditionType} 定价元素`);
                        updateResults.push({
                            salesOrderItem: salesOrderItem,
                            conditionType: conditionType,
                            status: 0,
                            success: false,
                            warning: true,
                            message: `行项目 ${salesOrderItem} 未找到 ${conditionType} 定价元素`
                        });
                    }
                }
            }
            
            console.log('定价元素更新完成，结果:', JSON.stringify(updateResults, null, 2));

            // 获取第一个销售订单号用于返回
            const firstSalesOrder = itemMapping.length > 0 ? itemMapping[0].salesOrder : '';

            // 检查所有定价元素修改结果
            const hasError = updateResults.some(r => r.error);
            const allSuccess = updateResults.length > 0 && updateResults.every(r => r.success) && !hasError;
            const failedItems = updateResults.filter(r => !r.success && !r.warning);
            
            if (allSuccess) {
                console.log('所有销售订单定价元素修改成功:', firstSalesOrder);
                return {
                    code: 'S',
                    message: '销售订单定价修改成功',
                    objkey: firstSalesOrder
                };
            } else if (updateResults.length === 0) {
                console.log('所有定价类型都没有需要更新的字段，步骤跳过');
                return {
                    code: 'S',
                    message: '所有定价类型都没有需要更新的字段，步骤跳过',
                    objkey: firstSalesOrder
                };
            } else if (failedItems.length === 0) {
                // 只有警告，没有错误
                console.log('销售订单定价修改完成（部分定价元素未找到）:', firstSalesOrder);
                return {
                    code: 'S',
                    message: '销售订单定价修改完成（部分定价元素未找到）',
                    objkey: firstSalesOrder
                };
            } else {
                const errorMessage = `定价元素修改失败: ${failedItems.map(i => i.message || `${i.salesOrderItem}-${i.conditionType}`).join(', ')}`;
                console.error(errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('SalesOrderPricingUpdateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '销售订单定价修改失败',
                objkey: ''
            };
        }
    }

    /**
     * 根据 zrfcid 和 canum 确定需要更新的定价类型
     * @param {string} zrfcid - 业务流程ID
     * @param {string} canum - 步骤号
     * @returns {Array} 定价类型配置列表
     */
    getPricingTypes(zrfcid, canum) {
        const step = parseInt(canum);
        
        // SD01 或 SD03 且步骤为 50：更新 PMP0（当 PurchasePrice 有值时）
        if ((zrfcid === 'SD01' || zrfcid === 'SD03') && step === 50) {
            return [{
                conditionType: 'PMP0',
                valueField: 'PurchasePrice',
                currencyField: null,
                quantityField: null
            }];
        }
        
        // SD03 且步骤为 10：更新 ZB01、ZB02、ZB03、ZB04、ZC01、ZC02、ZP00
        if (zrfcid === 'SD03' && step === 10) {
            return [
                { conditionType: 'ZB01', valueField: 'ZB01_Value', currencyField: 'ZB01_CurrencyCode', quantityField: 'ZB01_UnitOfMeasure' },
                { conditionType: 'ZB02', valueField: 'ZB02_Value', currencyField: 'ZB02_CurrencyCode', quantityField: 'ZB02_UnitOfMeasure' },
                { conditionType: 'ZB03', valueField: 'ZB03_Value', currencyField: 'ZB03_CurrencyCode', quantityField: 'ZB03_UnitOfMeasure' },
                { conditionType: 'ZB04', valueField: 'ZB04_Value', currencyField: 'ZB04_CurrencyCode', quantityField: 'ZB04_UnitOfMeasure' },
                { conditionType: 'ZC01', valueField: 'ZC01_Value', currencyField: 'ZC01_CurrencyCode', quantityField: 'ZC01_UnitOfMeasure' },
                { conditionType: 'ZC02', valueField: 'ZC02_Value', currencyField: 'ZC02_CurrencyCode', quantityField: 'ZC02_UnitOfMeasure' },
                { conditionType: 'ZP00', valueField: 'ZP00_Value', currencyField: 'ZP00_CurrencyCode', quantityField: 'ZP00_UnitOfMeasure' }
            ];
        }
        
        // 默认：更新 PMP0
        return [{
            conditionType: 'PMP0',
            valueField: 'PurchasePrice',
            currencyField: null,
            quantityField: null
        }];
    }

    /**
     * 检查是否需要跳过此步骤
     * @param {string} zrfcid - 业务流程ID
     * @param {string} canum - 步骤号
     * @param {Array} piSalesOrderRelRecords - PISalesOrderRel 记录列表
     * @returns {Promise<Object|null>} 如果需要跳过返回跳过结果，否则返回null
     */
    async checkSkipCondition(zrfcid, canum, piSalesOrderRelRecords) {
        const step = parseInt(canum);
        
        // SD01 或 SD03 且步骤为 50：检查 SalesOrder1 是否有值
        if ((zrfcid === 'SD01' || zrfcid === 'SD03') && step === 50) {
            for (const record of piSalesOrderRelRecords) {
                if (!record || !record.SalesOrder1) {
                    console.log(`PISalesOrderRel 中 SalesOrder1 为空，步骤跳过: PIOrder=${record?.PIOrder}, PIOrderItem=${record?.PIOrderItem}`);
                    return {
                        code: 'S',
                        message: 'PISalesOrderRel 中 SalesOrder1 为空，步骤跳过',
                        objkey: ''
                    };
                }
            }
        }
        
        // SD03 且步骤为 10：检查 SalesOrder 是否有值
        if (zrfcid === 'SD03' && step === 10) {
            for (const record of piSalesOrderRelRecords) {
                if (!record || !record.SalesOrder) {
                    console.log(`PISalesOrderRel 中 SalesOrder 为空，步骤跳过: PIOrder=${record?.PIOrder}, PIOrderItem=${record?.PIOrderItem}`);
                    return {
                        code: 'S',
                        message: 'PISalesOrderRel 中 SalesOrder 为空，步骤跳过',
                        objkey: ''
                    };
                }
            }
        }
        
        return null;
    }

    /**
     * 统一查询 PISalesOrderRel 表获取所有需要的字段
     * @param {Array} businessDataList - 业务数据列表
     * @returns {Promise<Array>} PISalesOrderRel 记录列表
     */
    async getPISalesOrderRelRecords(businessDataList) {
        const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
        const records = [];
        
        for (const businessData of businessDataList) {
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = String(businessData.PIOrderItem || '');
            
            if (piOrder && piOrderItem) {
                const record = await cds.run(
                    SELECT.one.from(PISalesOrderRel)
                        .columns(['PIOrder', 'PIOrderItem', 'PurchaseOrderItem1', 
                                 'SalesOrder', 'SalesOrderItem', 
                                 'SalesOrder1', 'SalesOrderItem1', 
                                 'SalesOrder2', 'SalesOrderItem2'])
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                if (record) {
                    records.push(record);
                }
            }
        }
        
        return records;
    }

    /**
     * 从查询结果中构建行项目号映射
     * @param {Array} businessDataList - 业务数据列表
     * @param {Array} piSalesOrderRelRecords - PISalesOrderRel 记录列表
     * @param {string} zrfcid - 业务流程ID
     * @param {string} canum - 步骤号
     * @returns {Array} 行项目号映射列表
     */
    buildItemMappingFromRecords(businessDataList, piSalesOrderRelRecords, zrfcid, canum) {
        const mappings = [];
        const step = parseInt(canum);
        
        for (const businessData of businessDataList) {
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = String(businessData.PIOrderItem || '');
            
            const record = piSalesOrderRelRecords.find(
                r => r.PIOrder === piOrder && r.PIOrderItem === piOrderItem
            );
            
            if (!record) {
                console.warn(`未找到 PISalesOrderRel 记录: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}`);
                continue;
            }
            
            // 根据业务类型选择不同的销售订单字段组
            let salesOrder, salesOrderItem;
            
            // SD03 步骤 10：对外销售订单，使用 SalesOrder/SalesOrderItem
            if (zrfcid === 'SD03' && step === 10) {
                salesOrder = record.SalesOrder;
                salesOrderItem = record.SalesOrderItem;
            }
            // SD01（任意步骤）或 SD03 步骤 30：公司间销售订单，使用 SalesOrder1/SalesOrderItem1
            else if (zrfcid === 'SD01' || (zrfcid === 'SD03' && step === 30)) {
                salesOrder = record.SalesOrder1;
                salesOrderItem = record.SalesOrderItem1;
            }
            
            if (salesOrder && salesOrderItem) {
                mappings.push({
                    piOrder: piOrder,
                    piOrderItem: piOrderItem,
                    purchaseOrderItem: salesOrderItem,
                    salesOrder: salesOrder,
                    netPriceAmount: businessData.PurchasePrice || 0,
                    businessData: businessData
                });
            }
        }
        
        console.log(`行项目映射结果: ${mappings.length} 条`);
        return mappings;
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

module.exports = SalesOrderPricingUpdateService;