const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

class MaterialDocumentService {
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
            // 入参只包含指定字段
            const { zrfcid, canum, serviceName, readsteps, objkey, zrfcLogid } = inputData;
            
            // 保存 zrfcLogid 到实例变量，供后续查询使用
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

            // 按照 TransferOrder 和 TransferOrderItem 排序
            businessDataList.sort((a, b) => {
                const orderA = a.TransferOrder || '';
                const orderB = b.TransferOrder || '';
                if (orderA !== orderB) {
                    return orderA.localeCompare(orderB);
                }
                const itemA = a.TransferOrderItem || '';
                const itemB = b.TransferOrderItem || '';
                return itemA.localeCompare(itemB);
            });

            // 构建物料凭证数据（MM02 需要异步查询批次库存）
            const materialDocData = await this.buildMaterialDocumentData(businessDataList, zrfcid);
 
            // 使用 SAP Cloud SDK 的 executeHttpRequest 方法获取 CSRF token
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader',
                    headers: {
                        'X-CSRF-Token': 'Fetch',
                        'Accept': 'application/json'
                    },
                }
            );

            // 提取 cookie（需要在 POST 请求中带上）
            const cookies = csrfResult.headers['set-cookie'] || [];

            // 构建 cookie 字符串
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            
            console.log('[MaterialDocumentService] 物料凭证API调用请求JSON:', JSON.stringify(materialDocData, null, 2));
            
            const result = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'POST',
                    url: '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader',
                    data: materialDocData,
                    headers: {
                        'X-CSRF-Token': csrfResult.headers['x-csrf-token'],
                        'Accept': 'application/json',
                        'Cookie': cookieString,
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true; // 接受所有状态码，以便查看详细的错误信息
                    }
                }
            );

            console.log('[MaterialDocumentService] 物料凭证API调用结果:', JSON.stringify(result.data, null, 2));
            console.log('[MaterialDocumentService] 物料凭证API状态码:', result.status);

            if (result.status >= 200 && result.status < 300) {
                // 从响应数据中提取物料凭证号和年度
                const docData = result.data.d || result.data;
                const materialDocument = docData.MaterialDocument || '';
                const materialDocumentYear = docData.MaterialDocumentYear || '';
                // 拼接物料凭证号+年度
                const objkey = materialDocument && materialDocumentYear ? `${materialDocument}${materialDocumentYear}` : '';
                
                return {
                    code: 'S',
                    message: '物料凭证创建成功',
                    objkey: objkey
                };
            } else {
                // 提取详细的错误信息
                let errorMessage = `API 调用失败: ${result.status}`;
                
                // SAP OData API 错误结构可能是 result.data.error 或直接 result.data
                const errorObj = result.data?.error || result.data;
                
                if (errorObj) {
                    const errorMessages = [];
                    
                    // 收集主错误消息
                    if (errorObj.message?.value) {
                        errorMessages.push(errorObj.message.value);
                    } else if (errorObj.message) {
                        errorMessages.push(errorObj.message);
                    }
                    
                    // 收集 errordetails 中的详细错误（可能在 error 或 innererror 中）
                    const errorDetails = errorObj.errordetails || errorObj.innererror?.errordetails;
                    if (errorDetails && Array.isArray(errorDetails)) {
                        for (const detail of errorDetails) {
                            if (detail.message) {
                                errorMessages.push(detail.message);
                            }
                        }
                    }
                    
                    // 合并错误消息
                    if (errorMessages.length > 0) {
                        errorMessage = errorMessages.join('; ');
                    }
                    
                    // 添加错误代码
                    if (errorObj.code) {
                        errorMessage = `${errorMessage} (${errorObj.code})`;
                    }
                }
                
                // 限制错误消息长度，避免超过系统限制
                errorMessage = errorMessage.substring(0, 500);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }
        } catch (error) {
            console.error('MaterialDocumentService 执行失败:', error);
            // 提取详细的错误信息
            let errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            
            // 处理 HTTP 响应错误
            if (error.response && error.response.data && error.response.data.error) {
                const errorData = error.response.data.error;
                const errorMessages = [];
                
                // 添加主错误消息
                if (errorData.message && errorData.message.value) {
                    errorMessages.push(errorData.message.value);
                } else if (errorData.message) {
                    errorMessages.push(errorData.message);
                }
                
                // 添加 errordetails 中的详细错误
                if (errorData.errordetails && Array.isArray(errorData.errordetails)) {
                    for (const detail of errorData.errordetails) {
                        if (detail.message) {
                            errorMessages.push(detail.message);
                        }
                    }
                }
                
                // 合并错误消息
                if (errorMessages.length > 0) {
                    errorMessage = errorMessages.join('; ');
                }
                
                // 添加错误代码
                if (errorData.code) {
                    errorMessage = `${errorMessage} (${errorData.code})`;
                }
                
                // 限制错误消息长度，避免超过系统限制
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

    async getBusinessData(businessTable, objkey) {
        try {
            // 动态获取业务表实体
            const BusinessEntity = cds.entities[businessTable];
            if (!BusinessEntity) {
                return {
                    code: 'E',
                    message: `业务表不存在: ${businessTable}`,
                    businessData: []
                };
            }

            // 根据不同业务表使用不同的查询条件
            let businessData;
            
            switch (businessTable) {
                case 'Transfer':
                    // Transfer 表优先使用 TransferOrder 作为查询条件，若为空则使用 zrfc_logid
                    if (objkey) {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ TransferOrder: objkey }));
                    } else {
                        // 第一步执行时 objkey 为空，使用 zrfc_logid 查询
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
                    }
                    break;
                case 'PITransfer':
                    // PITransfer 表使用 zrfc_logid 查询
                    if (objkey) {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ PIOrder: objkey }));
                    } else {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
                    }
                default:
                    // 默认使用 zrfc_logid 查询
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

    async buildMaterialDocumentData(businessDataList, zrfcid) {
        // 构建物料凭证头部数据（使用第一条记录的数据）
        const firstBusinessData = businessDataList[0];
        
        let formattedPostingDate;
        if (firstBusinessData.PostingDate) {
            const dateObj = new Date(firstBusinessData.PostingDate);
            // 格式：/Date(1234567890123)/
            formattedPostingDate = `/Date(${dateObj.getTime()})/`;
        } else {
            formattedPostingDate = `/Date(${new Date().getTime()})/`;
        }

        // 根据 zrfcid 选择 ReferenceDocument 字段
        // MM01 使用 TransferOrder
        // MM02 使用 PIOrder
        let referenceDocument = '';
        if (zrfcid === 'MM02') {
            referenceDocument = firstBusinessData.PIOrder || '';
        } else {
            referenceDocument = firstBusinessData.TransferOrder || '';
        }
        
        const header = {
            PostingDate: formattedPostingDate,
            MaterialDocumentHeaderText: zrfcid === 'MM01' ? (firstBusinessData.Customer || '') : '',
            ReferenceDocument: referenceDocument,
            GoodsMovementCode: firstBusinessData.GoodsMovementCode || ''
        };

        // 构建物料凭证行项目
        let items = [];
        
        if (zrfcid === 'MM02') {
            // MM02: 需要调用批次库存 API 查询批次，按数量分配
            items = await this.buildItemsWithBatchAllocation(businessDataList);
        } else {
            // MM01: 使用硬编码批次 '2025'
            items = this.buildItemsWithFixedBatch(businessDataList);
        }

        if (items.length > 0) {
            header.to_MaterialDocumentItem = {
                results: items
            };
        }

        return header;
    }

    /**
     * MM01 使用硬编码批次
     */
    buildItemsWithFixedBatch(businessDataList) {
        const items = [];
        for (const businessData of businessDataList) {
            if (businessData.Material || businessData.Product) {
                const itemText = businessData.TransferOrder && businessData.TransferOrderItem 
                    ? `${businessData.TransferOrder}-${businessData.TransferOrderItem}` : '';

                const item = {
                    Material: businessData.Material || '',
                    Plant: businessData.Plant || '',
                    StorageLocation: businessData.StorageLocation || '',
                    IssuingOrReceivingStorageLoc: businessData.IssuingOrReceivingStorageLoc || '',
                    GoodsMovementType: businessData.GoodsMovementType || '',
                    QuantityInEntryUnit: businessData.QuantityInBaseUnit || 0,
                    Batch: '2025',
                    MaterialDocumentItemText: itemText
                };

                items.push(item);
            }
        }
        return items;
    }

    /**
     * MM02 查询批次库存并按数量分配批次
     */
    async buildItemsWithBatchAllocation(businessDataList) {
        console.log('[MaterialDocumentService] buildItemsWithBatchAllocation - 开始执行');
        console.log('[MaterialDocumentService] buildItemsWithBatchAllocation - businessDataList 长度:', businessDataList.length);
        console.log('[MaterialDocumentService] buildItemsWithBatchAllocation - businessDataList:', JSON.stringify(businessDataList, null, 2));
        
        const items = [];

        // 按物料+工厂+库位分组查询
        const materialPlantStorageMap = new Map();
        for (const businessData of businessDataList) {
            if (businessData.Material && businessData.Plant) {
                const key = `${businessData.Material}-${businessData.Plant}-${businessData.StorageLocation || ''}`;
                if (!materialPlantStorageMap.has(key)) {
                    materialPlantStorageMap.set(key, {
                        Material: businessData.Material,
                        Plant: businessData.Plant,
                        StorageLocation: businessData.StorageLocation || ''
                    });
                }
            }
        }
        
        console.log('[MaterialDocumentService] buildItemsWithBatchAllocation - materialPlantStorageMap:', JSON.stringify(Array.from(materialPlantStorageMap.values()), null, 2));

        // 批量查询批次库存
        const batchStockMap = await this.queryBatchStockForMaterials(Array.from(materialPlantStorageMap.values()));
       
        // 为每条业务数据分配批次
        for (const businessData of businessDataList) {
            if (!businessData.Material || !businessData.Plant) {
                continue;
            }

            const requiredQty = businessData.QuantityInBaseUnit || 0;
            const key = `${businessData.Material}-${businessData.Plant}-${businessData.StorageLocation || ''}`;
            const batchStocks = batchStockMap.get(key) || [];
            
            console.log('[MaterialDocumentService] buildItemsWithBatchAllocation - 处理物料:', businessData.Material, '工厂:', businessData.Plant, '库位:', businessData.StorageLocation);
            console.log('[MaterialDocumentService] buildItemsWithBatchAllocation - 需求数量:', requiredQty);
            console.log('[MaterialDocumentService] buildItemsWithBatchAllocation - 可用批次库存:', JSON.stringify(batchStocks, null, 2));

            // 按库存数量降序排序，优先使用库存多的批次
            const sortedStocks = [...batchStocks].sort((a, b) => (b.StockQty || 0) - (a.StockQty || 0));

            let remainingQty = requiredQty;
            let allocatedBatches = [];

            // 分配批次
            for (const stock of sortedStocks) {
                if (remainingQty <= 0) {
                    break;
                }

                const stockQty = stock.StockQty || 0;
                const allocateQty = Math.min(remainingQty, stockQty);

                if (allocateQty > 0) {
                    allocatedBatches.push({
                        Batch: stock.Batch || '',
                        Quantity: allocateQty
                    });
                    remainingQty -= allocateQty;
                }
            }

            // 生成行项目（可能多条）
            const itemText = businessData.PIOrder && businessData.PIOrderItem 
                ? `${businessData.PIOrder}-${businessData.PIOrderItem}` : '';

            for (const batchItem of allocatedBatches) {
                const item = {
                    Material: businessData.Material || '',
                    Plant: businessData.Plant || '',
                    StorageLocation: businessData.StorageLocation || '',
                    IssuingOrReceivingStorageLoc: businessData.IssuingOrReceivingStorageLoc || '',
                    GoodsMovementType: businessData.GoodsMovementType || '',
                    QuantityInEntryUnit: String(batchItem.Quantity),
                    Batch: batchItem.Batch,
                    MaterialDocumentItemText: itemText
                };
                items.push(item);
            }

            // 如果批次库存不足，报错并停止执行
            if (remainingQty > 0) {
                const shortage = remainingQty;
                const errorMsg = `物料 ${businessData.Material} 在工厂 ${businessData.Plant} 批次库存不足，需求 ${requiredQty}，可用库存不足，缺少 ${shortage}`;
                console.error(`[MaterialDocumentService] ${errorMsg}`);
                throw new Error(errorMsg);
            }
        }

        return items;
    }

    /**
     * 调用批次库存 API 查询多个物料的批次库存
     */
    async queryBatchStockForMaterials(materialPlantStorageList) {
        const batchStockMap = new Map();

        for (const { Material, Plant, StorageLocation } of materialPlantStorageList) {
            try {
                // 构建 $filter 参数
                const filter = `Material eq '${Material}' and Plant eq '${Plant}' and StorageLocation eq '${StorageLocation || ''}'`;
                const url = `/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod?$filter=${encodeURIComponent(filter)}&$select=Material,Plant,Batch,StorageLocation,MatlWrhsStkQtyInMatlBaseUnit`;
                
                console.log('[MaterialDocumentService] queryBatchStockForMaterials - 查询URL:', url);

                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
                    },
                    {
                        method: 'GET',
                        url: url,
                        headers: {
                            'Accept': 'application/json'
                        },
                        validateStatus: function (status) {
                            return status >= 200 && status < 300;
                        }
                    }
                );

                const stockData = result.data.d || result.data;
                const stocks = Array.isArray(stockData.results) ? stockData.results : [];

                // 过滤出有库存的批次
                const validStocks = stocks
                    .filter(stock => stock.Batch && (stock.MatlWrhsStkQtyInMatlBaseUnit || 0) > 0)
                    .map(stock => ({
                        Batch: stock.Batch,
                        StockQty: parseFloat(stock.MatlWrhsStkQtyInMatlBaseUnit) || 0,
                        StorageLocation: stock.StorageLocation
                    }));

                batchStockMap.set(`${Material}-${Plant}-${StorageLocation}`, validStocks);
            } catch (error) {
                console.error(`[MaterialDocumentService] 查询物料 ${Material} 批次库存失败:`, error.message);
                batchStockMap.set(`${Material}-${Plant}-${StorageLocation}`, []);
            }
        }

        return batchStockMap;
    }
}

module.exports = MaterialDocumentService;