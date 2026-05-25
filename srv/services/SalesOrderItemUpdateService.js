const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class SalesOrderItemUpdateService {
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

            // 统一查询 PISalesOrderRel 表获取所有需要的字段
            const piSalesOrderRelRecords = await this.getPISalesOrderRelRecords(businessDataList);

            if (piSalesOrderRelRecords.length === 0) {
                return {
                    code: 'E',
                    message: '未找到 PISalesOrderRel 映射记录',
                    objkey: ''
                };
            }

            // 检查是否需要跳过此步骤
            const skipResult = await this.checkSkipCondition(zrfcid, canum, piSalesOrderRelRecords);
            if (skipResult) {
                return skipResult;
            }

            // 从查询结果中获取销售订单和行项目号映射
            const itemMapping = this.buildItemMappingFromRecords(businessDataList, piSalesOrderRelRecords, zrfcid, canum);

            // 如果没有有效的映射结果，返回跳过状态
            if (!itemMapping || itemMapping.length === 0) {
                const step = parseInt(canum);
                let message = 'PISalesOrderRel 中 SalesOrder 为空，步骤跳过';
                
                // 判断业务类型，使用对应的字段名
                if ((zrfcid === 'SD01' || zrfcid === 'SD03') && (step === 40 || step === 50)) {
                    message = 'PISalesOrderRel 中 SalesOrder1 为空，步骤跳过';
                } else if (zrfcid === 'SD03' && step === 10) {
                    message = 'PISalesOrderRel 中 SalesOrder 为空，步骤跳过';
                }
                
                return {
                    code: 'S',
                    message: message,
                    objkey: ''
                };
            }

            // 获取第一个销售订单号用于获取 CSRF token
            const firstSalesOrder = itemMapping[0].salesOrder;

            // 获取 CSRF token 和 ETag（使用 OData V2 格式）
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder('${firstSalesOrder}')`,
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
            
            // 逐条修改行项目
            const updateResults = [];
            for (const mapping of itemMapping) {
                const { salesOrder, salesOrderItem, businessData } = mapping;
                
                // 构建行项目修改数据
                const itemData = this.buildItemData(businessData, mptStepConfig, salesOrderItem);
                
                // 如果没有需要更新的字段，跳过该行项目
                if (Object.keys(itemData).length === 0) {
                    console.log(`行项目 ${salesOrder} - ${salesOrderItem} 没有需要更新的字段，跳过`);
                    continue;
                }
                
                console.log(`开始修改销售订单行项目: ${salesOrder} - ${salesOrderItem}`);
                console.log('修改数据:', JSON.stringify(itemData, null, 2));

                // 调用销售订单行项目修改 API（OData V2 格式）
                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'PATCH',
                        url: `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrderItem(SalesOrder='${salesOrder}',SalesOrderItem='${salesOrderItem}')`,
                        data: itemData,
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

                updateResults.push({
                    salesOrder: salesOrder,
                    salesOrderItem: salesOrderItem,
                    status: result.status,
                    success: result.status >= 200 && result.status < 300
                });
            }

            // 检查所有行项目修改结果
            const allSuccess = updateResults.every(r => r.success);
            const failedItems = updateResults.filter(r => !r.success);
            
            // 如果没有任何行项目需要更新，返回跳过状态
            if (updateResults.length === 0) {
                console.log('所有行项目都没有需要更新的字段，步骤跳过');
                return {
                    code: 'S',
                    message: '所有行项目都没有需要更新的字段，步骤跳过',
                    objkey: firstSalesOrder
                };
            }
            
            if (allSuccess) {
                console.log('所有销售订单行项目修改成功');
                return {
                    code: 'S',
                    message: '销售订单行项目修改成功',
                    objkey: firstSalesOrder
                };
            } else {
                const errorMessage = `部分行项目修改失败: ${failedItems.map(i => `${i.salesOrder}-${i.salesOrderItem}`).join(', ')}`;
                console.error(errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('SalesOrderItemUpdateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '销售订单行项目修改失败',
                objkey: ''
            };
        }
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
                        .columns(['PIOrder', 'PIOrderItem', 'SalesOrder', 'SalesOrder1', 'SalesOrderItem1'])
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
            // SD01/SD03 步骤 50：公司间销售订单，使用 SalesOrder1/SalesOrderItem1（SalesOrder2/SalesOrderItem2 留作未来其他场景使用）
            else if ((zrfcid === 'SD01' || zrfcid === 'SD03') && step === 50) {
                salesOrder = record.SalesOrder1;
                salesOrderItem = record.SalesOrderItem1;
            }
            
            if (salesOrder && salesOrderItem) {
                mappings.push({
                    piOrder: piOrder,
                    piOrderItem: piOrderItem,
                    salesOrder: salesOrder,
                    salesOrderItem: salesOrderItem,
                    businessData: businessData
                });
            }
        }
        
        return mappings;
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

    buildItemData(businessData, mptStepConfig, salesOrderItem) {
        const item = {};

        // 只有当字段有值时才赋值更新
        if (businessData.YY1_FD_FNSKU) {
            item.YY1_FD_FNSKU_SDI = businessData.YY1_FD_FNSKU;
        }
        if (businessData.YY1_FD_SKU) {
            item.YY1_FD_SKU_SDI = businessData.YY1_FD_SKU;
        }
        if (businessData.YY1_FD_DZKB) {
            item.YY1_FD_DZKB_SDI = businessData.YY1_FD_DZKB;
        }
        if (businessData.RequestedQuantity) {
            item.RequestedQuantity = businessData.RequestedQuantity;
        }
        if (businessData.RequestedQuantityUnit) {
            item.RequestedQuantityUnit = businessData.RequestedQuantityUnit;
        }
        if (businessData.RequestedQuantityUnit) {
            item.RequestedQuantityUnit = businessData.RequestedQuantityUnit;
        }
        if (businessData.ProductionPlant) {
            item.ProductionPlant = businessData.ProductionPlant;
        }
        if (businessData.Material) {
            item.Material = businessData.Material;
        }
        if (businessData.MaterialByCustomer) {
            item.MaterialByCustomer = businessData.MaterialByCustomer;
        }
        if (businessData.SalesOrderItemCategory) {
            item.SalesOrderItemCategory = businessData.SalesOrderItemCategory;
        }
        if (businessData.SalesDocumentRjcnReason) {
            item.SalesDocumentRjcnReason = businessData.SalesDocumentRjcnReason;
        }      
        return item;
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

module.exports = SalesOrderItemUpdateService;