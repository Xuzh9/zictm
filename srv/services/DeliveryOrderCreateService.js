const cds = require('@sap/cds');
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
                    message: `未找到业务数据`,
                    objkey: ''
                };
                console.log('[DeliveryOrderCreateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

            let sourceDocument;
            let salesOrderType;
            let mainRowDataListForDelivery = businessDataList;

            // 如果是 SD07 或 SD10，需要根据业务表的 DeliveryDocument 和 DeliveryDocumentItem
            // 查询 PIDeliveryRel 获取 PIOrder 和 PIOrderItem，再查询 PISalesOrderRel 获取 SalesOrder
            if (zrfcid === 'SD07' || zrfcid === 'SD10') {
                console.log('[DeliveryOrderCreateService] SD07/SD10 业务数据条数:', businessDataList.length);
                businessDataList.forEach((item, idx) => {
                    console.log(`[DeliveryOrderCreateService] 业务数据[${idx}] ParentItem: '${item.ParentItem}', DeliveryDocument: ${item.DeliveryDocument}, DeliveryDocumentItem: ${item.DeliveryDocumentItem}`);
                });

                // 过滤出 ParentItem 为空或 '000000' 的业务数据（只创建主行，批次拆分行由 DeliveryOrderBatchSplitService 处理）
                const mainRowDataList = businessDataList.filter(item => !item.ParentItem || item.ParentItem.trim() === '' || item.ParentItem === '000000');
                console.log('[DeliveryOrderCreateService] 过滤后主行数据条数:', mainRowDataList.length);
                mainRowDataListForDelivery = mainRowDataList;

                const PIDeliveryRel = cds.entities['com.sap.zictm.PIDeliveryRel'];
                const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];

                // 收集所有 DeliveryDocument（PIDeliveryRel 主键已取消 DeliveryDocumentItem）
                const deliveryDocuments = mainRowDataList.map(item => item.DeliveryDocument).filter(v => v);

                if (deliveryDocuments.length > 0) {
                    // 批量查询 PIDeliveryRel（只使用 DeliveryDocument）
                    const deliveryRelDataList = await cds.run(
                        SELECT.from(PIDeliveryRel).where({
                            zrfc_logid: zrfcLogid,
                            DeliveryDocument: { in: deliveryDocuments }
                        })
                    );

                    console.log('[DeliveryOrderCreateService] SD07/SD10 获取 PIDeliveryRel 数据:', JSON.stringify(deliveryRelDataList));

                    if (deliveryRelDataList && deliveryRelDataList.length > 0) {
                        // 构建 DeliveryDocument -> {PIOrder, PIOrderItem} 的映射
                        const deliveryToPiMap = new Map();
                        deliveryRelDataList.forEach(item => {
                            if (item.DeliveryDocument) {
                                deliveryToPiMap.set(item.DeliveryDocument, {
                                    PIOrder: item.PIOrder,
                                    PIOrderItem: item.PIOrderItem
                                });
                            }
                        });

                        // 使用 deliveryRelDataList 中的 PIOrder/PIOrderItem 更新 mainRowDataList
                        mainRowDataList.forEach(item => {
                            const piInfo = deliveryToPiMap.get(item.DeliveryDocument);
                            if (piInfo) {
                                item.PIOrder = piInfo.PIOrder;
                                item.PIOrderItem = piInfo.PIOrderItem;
                            }
                        });

                        // 收集 PIOrder 和 PIOrderItem
                        const piOrders = deliveryRelDataList.map(item => item.PIOrder).filter(v => v);
                        const piOrderItems = deliveryRelDataList.map(item => item.PIOrderItem).filter(v => v);

                        // 批量查询 PISalesOrderRel
                        const salesOrderRels = await cds.run(
                            SELECT.from(PISalesOrderRel).where({
                                PIOrder: { in: piOrders },
                                PIOrderItem: { in: piOrderItems }
                            })
                        );

                        console.log('[DeliveryOrderCreateService] SD07/SD10 获取 PISalesOrderRel 数据:', JSON.stringify(salesOrderRels));

                        // 构建 PI -> PISalesOrderRel 的映射
                        const piToRelMap = new Map();
                        salesOrderRels.forEach(rel => {
                            if (rel.PIOrder && rel.PIOrderItem) {
                                const key = `${rel.PIOrder}-${rel.PIOrderItem}`;
                                piToRelMap.set(key, rel);
                            }
                        });

                        // 根据 zrfcid 将对应字段设置到 mainRowDataList 中
                        // SD07 设置 SalesOrder，SD10 设置 PurchaseOrder1
                        mainRowDataList.forEach(item => {
                            const piKey = `${item.PIOrder}-${item.PIOrderItem}`;
                            if (piToRelMap.has(piKey)) {
                                const rel = piToRelMap.get(piKey);
                                if (zrfcid === 'SD07') {
                                    item.SalesOrder = rel.SalesOrder;
                                } else if (zrfcid === 'SD10') {
                                    item.PurchaseOrder1 = rel.PurchaseOrder1;
                                }
                            }
                        });

                        // 根据 zrfcid 确定 sourceDocument
                        // SD07 使用 SalesOrder，SD10 使用 PurchaseOrder1
                        if (salesOrderRels.length > 0) {
                            if (zrfcid === 'SD07') {
                                sourceDocument = salesOrderRels[0].SalesOrder;
                                console.log('[DeliveryOrderCreateService] SD07 获取 SalesOrder:', sourceDocument);
                            } else if (zrfcid === 'SD10') {
                                sourceDocument = salesOrderRels[0].PurchaseOrder1;
                                console.log('[DeliveryOrderCreateService] SD10 获取 PurchaseOrder1:', sourceDocument);
                            }
                        }

                        // 通过 PIOrder/PIOrderItem 查询 SalesOrderCreate 表获取 SalesOrderType
                        if (piOrders.length > 0 && piOrderItems.length > 0) {
                            const SalesOrderCreate = cds.entities['com.sap.zictm.SalesOrderCreate'];
                            const salesOrderCreates = await cds.run(
                                SELECT.from(SalesOrderCreate).where({
                                    PIOrder: { in: piOrders },
                                    PIOrderItem: { in: piOrderItems }
                                })
                            );

                            console.log('[DeliveryOrderCreateService] SD07/SD10 获取 SalesOrderCreate 数据:', JSON.stringify(salesOrderCreates));

                            // SD07/SD10 直接从查询结果获取 SalesOrderType
                            if (salesOrderCreates.length > 0 && salesOrderCreates[0].SalesOrderType) {
                                salesOrderType = salesOrderCreates[0].SalesOrderType;
                                console.log('[DeliveryOrderCreateService] SD07/SD10 获取 SalesOrderType:', salesOrderType);
                            }
                        }
                    }
                }
            } else {
                // 使用通用工具类读取之前步骤的 objkey（销售订单号）
                sourceDocument = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
                // 获取销售订单类型（从第一条业务数据获取）
                salesOrderType = businessDataList[0]?.SalesOrderType;
            }

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);
            
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
            
            // 根据 zrfcid、canum 和销售订单类型确定 API 配置
            let csrfUrl, createUrl;
            if (((zrfcid === 'SD02' && canum === 30) || (zrfcid === 'SD04' && canum === 150) || (zrfcid === 'SD07' && canum === 50) || (zrfcid === 'SD11' && canum === 60)) && salesOrderType === 'CBRE') {
                // 使用退货交货单 API
                csrfUrl = '/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=2/A_ReturnsDeliveryHeader';
                createUrl = '/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=2/A_ReturnsDeliveryHeader';
            } else {
                // 使用外向交货单 API
                csrfUrl = '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/';
                createUrl = '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader';
            }

            // 获取 CSRF token
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

            // 提取 cookie 和 CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];

            // 构建交货单创建数据（传入主行数据，一次性创建一张交货单）
            const deliveryOrderData = await this.buildDeliveryOrderData(mainRowDataListForDelivery, mptStepConfig, zrfcid, canum, salesOrderType, sourceDocument);
            
            console.log('交货单数据:', JSON.stringify(deliveryOrderData, null, 2));

            // 调用交货单创建 API（一次性创建一张交货单，含所有行项目）
            const result = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'POST',
                    url: createUrl,
                    data: deliveryOrderData,
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        'Accept': 'application/json',
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
                const deliveryDocument = responseData?.d?.DeliveryDocument || '';

                console.log('交货单创建成功:', deliveryDocument);

                // SD07/SD10 需要更新 PIDeliveryRel 表
                if (zrfcid === 'SD07' || zrfcid === 'SD10') {
                    // 从返回结果中获取行项目号
                    const deliveryItems = responseData?.d?.to_DeliveryDocumentItem?.results || [];
                    console.log('[DeliveryOrderCreateService] 交货单行项目:', JSON.stringify(deliveryItems));

                    // 批量更新 PIDeliveryRel（使用原始业务数据，包括批次拆分行）
                    await this.updatePIDeliveryRel(deliveryDocument, deliveryItems, businessDataList, salesOrderType);
                }

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
            const referenceItem = (zrfcid === 'SD02' || zrfcid === 'SD04' || zrfcid === 'SD11') 
                ? item.SalesOrderItem 
                : item.PIOrderItem;
            
            // (STO) 使用 5 位数，其他情况使用 6 位数
            const digitCount = (zrfcid === 'SD04' && canum === 60) || (zrfcid === 'SD11' && canum === 100) ? 5 : 6;
            
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
     * 将交货单号批量更新到 PIDeliveryRel 表（SD07/SD10 使用）
     * 只更新 ParentItem 为空的行（批次拆分前的主行）
     * @param {string} deliveryDocument - 创建的交货单号
     * @param {Array} deliveryItems - 交货单行项目列表
     * @param {Array} businessDataList - 业务数据列表
     * @param {string} salesOrderType - 销售订单类型
     */
    async updatePIDeliveryRel(deliveryDocument, deliveryItems, businessDataList, salesOrderType) {
        try {
            const PIDeliveryRel = cds.entities['com.sap.zictm.PIDeliveryRel'];
            const { UPDATE, SELECT } = cds.ql;

            const businessDeliveryDocuments = businessDataList.map(b => b.DeliveryDocument || '').filter(v => v);
            const businessDeliveryItems = businessDataList.map(b => b.DeliveryDocumentItem || '').filter(v => v);

            if (businessDeliveryDocuments.length === 0 || businessDeliveryItems.length === 0) {
                console.warn('[updatePIDeliveryRel] 业务数据为空，跳过更新');
                return;
            }

            console.log(`[updatePIDeliveryRel] 开始批量更新 PIDeliveryRel, deliveryDocument=${deliveryDocument}, businessDataList.length=${businessDataList.length}`);

            // 批量查询 PIDeliveryRel 记录
            const existingRecords = await cds.run(
                SELECT.from(PIDeliveryRel)
                    .where({
                        DeliveryDocument: { in: businessDeliveryDocuments },
                        DeliveryDocumentItem: { in: businessDeliveryItems }
                    })
            );

            console.log(`[updatePIDeliveryRel] 查询到 ${existingRecords.length} 条 PIDeliveryRel 记录`);

            // 按 DeliveryDocument+DeliveryDocumentItem 建立映射
            const existingMap = new Map();
            existingRecords.forEach(record => {
                const key = `${record.DeliveryDocument}-${record.DeliveryDocumentItem}`;
                existingMap.set(key, record);
            });

            // 构建批量更新的 SET 数据列表
            const updateTasks = [];
            for (let i = 0; i < businessDataList.length; i++) {
                const businessData = businessDataList[i];
                const businessDeliveryItem = businessData.DeliveryDocumentItem || '000010';
                const key = `${businessData.DeliveryDocument}-${businessDeliveryItem}`;
                const existingRecord = existingMap.get(key);

                if (!existingRecord) {
                    console.warn(`[updatePIDeliveryRel] 未找到匹配的 PIDeliveryRel 记录: ${key}`);
                    continue;
                }

                const setData = { DeliveryNo1: deliveryDocument, DeliveryNoItem1: businessDeliveryItem };
                if (salesOrderType) {
                    setData.SalesOrderType = salesOrderType;
                }

                updateTasks.push({
                    where: {
                        PIOrder: existingRecord.PIOrder,
                        PIOrderItem: existingRecord.PIOrderItem,
                        DeliveryDocument: existingRecord.DeliveryDocument,
                        DeliveryDocumentItem: existingRecord.DeliveryDocumentItem
                    },
                    setData
                });
            }

            // 批量执行更新（顺序）
            let updatedCount = 0;
            for (const task of updateTasks) {
                const result = await cds.run(UPDATE(PIDeliveryRel).set(task.setData).where(task.where));
                console.log(`[updatePIDeliveryRel] 更新 PIDeliveryRel: PIOrder=${task.where.PIOrder}, PIOrderItem=${task.where.PIOrderItem}, DeliveryNo1=${task.setData.DeliveryNo1}, 结果=${result}`);
                updatedCount++;
            }

            console.log(`[updatePIDeliveryRel] 批量更新完成，共更新 ${updatedCount} 条`);
        } catch (error) {
            console.error(`[updatePIDeliveryRel] PIDeliveryRel 批量更新失败:`, error);
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

        const messages = [];
        // 取主错误消息
        if (errorData?.error?.message?.value) {
            messages.push(errorData.error.message.value);
        } else if (errorData?.error?.message) {
            messages.push(errorData.error.message);
        } else if (errorData?.message) {
            messages.push(errorData.message);
        }
        // 取 errordetails 中的消息
        if (errorData?.error?.innererror?.errordetails && errorData.error.innererror.errordetails.length > 0) {
            const detailMessages = errorData.error.innererror.errordetails.map(d => d.message).filter(m => m);
            if (detailMessages.length > 0) {
                messages.push(...detailMessages);
            }
        }
        // 拼接所有消息
        if (messages.length > 0) {
            return messages.join('; ');
        } else {
            return JSON.stringify(errorData);
        }
    }
}

module.exports = DeliveryOrderCreateService;