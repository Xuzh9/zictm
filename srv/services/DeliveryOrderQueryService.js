const cds = require('@sap/cds');
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

            // 获取销售订单类型，判断是否为借贷项订单（CR/DR）
            const salesOrderType = await this.getSalesOrderType(zrfcLogid, zrfcid, canum);
            if (salesOrderType === 'CR' || salesOrderType === 'DR') {
                console.log(`[DeliveryOrderQueryService] 销售订单类型 ${salesOrderType} 为借贷项订单，步骤跳过`);
                return {
                    code: 'S',
                    message: `销售订单类型 ${salesOrderType} 为借贷项订单，跳过内向交货单查询`,
                    objkey: ''
                };
            }

            // 如果是 SD09/SD07/SD10，从业务表获取 RefDocNo
            let referenceSDDocument;
            if (zrfcid === 'SD07' || zrfcid === 'SD09' || (zrfcid === 'SD10' && canum === 10)) {
                referenceSDDocument = await this.getRefDocNoFromBusinessTable(zrfcLogid);
            } else if (zrfcid === 'SD10' && canum === 100) {
                referenceSDDocument = await this.getRefDocNoFromPIDeliveryRel(zrfcLogid);
            } else {
                // 使用通用工具类读取之前步骤的 objkey
                referenceSDDocument = objkey;
                const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
                if (previousObjkey) {
                    referenceSDDocument = previousObjkey;
                }
            }

            const queryResult = await this.queryInboundDeliveryByReference(referenceSDDocument);

            // 如果查询成功且 zrfcid 为 SD07/SD09/SD10，更新 PIDeliveryRel
            if (queryResult.code === 'S' && (zrfcid === 'SD07' || zrfcid === 'SD09' || zrfcid === 'SD10')) {
                await this.updatePIDeliveryRel(zrfcLogid, referenceSDDocument, queryResult.inboundDeliveries, zrfcid, canum);
            }

            return queryResult;

        } catch (error) {
            console.error('DeliveryOrderQueryService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '查询内向交货单失败',
                objkey: ''
            };
        }
    }

    /**
     * 获取销售订单类型（SD07/SD11 canum=70 从 PIDeliveryRel 获取，其他从业务表获取）
     * @param {string} zrfcLogid - 多步ID
     * @param {string} zrfcid - 业务流程ID
     * @param {number} canum - 步骤号
     * @returns {Promise<string|null>} 销售订单类型
     */
    async getSalesOrderType(zrfcLogid, zrfcid, canum) {
        try {
            // 从 ProcessConfig 获取业务表名
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const config = await cds.run(
                SELECT.one.from(ProcessConfig).where({ zrfcid: zrfcid })
            );
            if (!config?.businessTable1) return null;
            
            const entity = cds.entities[`com.sap.zictm.${config.businessTable1}`];
            if (!entity) return null;
            
            // 查询业务表数据
            const businessData = await cds.run(
                SELECT.one.from(entity)
                    .where({ zrfc_logid: zrfcLogid })
            );
            if (!businessData) return null;

            if (zrfcid === 'SD07' || zrfcid === 'SD10' || zrfcid === 'SD11' ) {
                const PIDeliveryRel = cds.entities['com.sap.zictm.PIDeliveryRel'];
                const piDeliveryRel = await cds.run(
                    SELECT.one.from(PIDeliveryRel)
                        .columns(['SalesOrderType'])
                        .where({
                            DeliveryDocument: businessData.DeliveryDocument,
                            DeliveryDocumentItem: businessData.DeliveryDocumentItem
                        })
                );
                return piDeliveryRel?.SalesOrderType || null;
            } else {
                // 其他从业务表获取
                return businessData.SalesOrderType || null;
            }
        } catch (error) {
            console.error('[DeliveryOrderQueryService.getSalesOrderType] 查询失败:', error);
            return null;
        }
    }

    async getRefDocNoFromPIDeliveryRel(zrfcLogid) {
        try {
            const DeliveryActualInfo = cds.entities['com.sap.zictm.DeliveryActualInfo'];
            const PIDeliveryRel = cds.entities['com.sap.zictm.PIDeliveryRel'];
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];

            const businessDataList = await cds.run(
                SELECT.from(DeliveryActualInfo)
                    .columns(['DeliveryDocument', 'DeliveryDocumentItem'])
                    .where({ zrfc_logid: zrfcLogid })
            );

            if (!businessDataList || businessDataList.length === 0) {
                console.warn(`[getRefDocNoFromPIDeliveryRel] 未找到业务数据，zrfcLogid: ${zrfcLogid}`);
                return null;
            }

            const deliveryDocuments = [...new Set(businessDataList.map(item => item.DeliveryDocument).filter(v => v))];
            const deliveryItems = [...new Set(businessDataList.map(item => item.DeliveryDocumentItem).filter(v => v))];

            if (deliveryDocuments.length === 0 || deliveryItems.length === 0) {
                console.warn('[getRefDocNoFromPIDeliveryRel] DeliveryDocument 或 DeliveryDocumentItem 为空');
                return null;
            }

            const piDeliveryRels = await cds.run(
                SELECT.from(PIDeliveryRel)
                    .columns(['PIOrder', 'PIOrderItem'])
                    .where({
                        DeliveryDocument: { in: deliveryDocuments },
                        DeliveryDocumentItem: { in: deliveryItems }
                    })
            );

            if (!piDeliveryRels || piDeliveryRels.length === 0) {
                console.warn('[getRefDocNoFromPIDeliveryRel] 未找到 PIDeliveryRel 记录');
                return null;
            }

            const piOrders = [...new Set(piDeliveryRels.map(item => item.PIOrder).filter(v => v))];
            const piOrderItems = [...new Set(piDeliveryRels.map(item => item.PIOrderItem).filter(v => v))];

            if (piOrders.length === 0 || piOrderItems.length === 0) {
                console.warn('[getRefDocNoFromPIDeliveryRel] PIOrder 或 PIOrderItem 为空');
                return null;
            }

            const salesOrderRels = await cds.run(
                SELECT.from(PISalesOrderRel)
                    .columns(['PurchaseOrder1'])
                    .where({
                        PIOrder: { in: piOrders },
                        PIOrderItem: { in: piOrderItems }
                    })
            );

            if (salesOrderRels && salesOrderRels.length > 0 && salesOrderRels[0].PurchaseOrder1) {
                const purchaseOrder1 = salesOrderRels[0].PurchaseOrder1;
                console.log(`[getRefDocNoFromPIDeliveryRel] 获取 PurchaseOrder1: ${purchaseOrder1}`);
                return purchaseOrder1;
            }

            console.warn('[getRefDocNoFromPIDeliveryRel] 未找到 PurchaseOrder1');
            return null;
        } catch (error) {
            console.error('[getRefDocNoFromPIDeliveryRel] 查询失败:', error);
            return null;
        }
    }

    async getRefDocNoFromBusinessTable(zrfcLogid) {
        try {
            const DeliveryActualInfo = cds.entities['com.sap.zictm.DeliveryActualInfo'];
            
            // 只通过 zrfc_logid 查询业务表
            const businessDataList = await cds.run(
                SELECT.from(DeliveryActualInfo)
                    .columns(['RefDocNo', 'DeliveryDocument'])
                    .where({ zrfc_logid: zrfcLogid })
            );

            if (businessDataList && businessDataList.length > 0 && businessDataList[0].RefDocNo) {
                const refDocNo = businessDataList[0].RefDocNo;
                const deliveryDocument = businessDataList[0].DeliveryDocument;
                console.log(`[getRefDocNoFromBusinessTable] 从业务表获取 RefDocNo: ${refDocNo}, DeliveryDocument: ${deliveryDocument}`);
                return refDocNo;
            }
            
            console.warn(`[getRefDocNoFromBusinessTable] 未找到 RefDocNo，zrfcLogid: ${zrfcLogid}`);
            return null;
        } catch (error) {
            console.error('[getRefDocNoFromBusinessTable] 查询业务表失败:', error);
            return null;
        }
    }

    async queryInboundDeliveryByReference(referenceSDDocument) {
        const maxRetries = 20;
        const retryDelay = 5000;

        if (!referenceSDDocument) {
            return {
                code: 'E',
                message: 'ReferenceSDDocument 不能为空',
                objkey: ''
            };
        }

        const filter = `ReferenceSDDocument eq '${referenceSDDocument}'`;
        const url = `/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002/A_InbDeliveryItem?$filter=${encodeURIComponent(filter)}`;

        for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
            try {
                const result = await this.commonUtils.executeHttpRequestWithRetry(
                    {
                        destinationName: this.commonUtils.getDestinationName()
                    },
                    {
                        method: 'GET',
                        url: url,
                        headers: {
                            'Accept': 'application/json',
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
                        objkey: inboundDeliveries[0]?.DeliveryDocument,
                        inboundDeliveries: inboundDeliveries
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

    async updatePIDeliveryRel(zrfcLogid, outboundDeliveryNo, inboundDeliveries, zrfcid, canum) {
        try {
            console.log('[updatePIDeliveryRel] 开始更新 PIDeliveryRel，外向交货单:', outboundDeliveryNo, '内向交货单数量:', inboundDeliveries.length, 'zrfcid:', zrfcid, 'canum:', canum);

            // 获取实体引用
            const PIDeliveryRel = cds.entities['com.sap.zictm.PIDeliveryRel'];
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const DeliveryActualInfo = cds.entities['com.sap.zictm.DeliveryActualInfo'];

            // 查询业务表，获取所有 DeliveryDocument、DeliveryDocumentItem、RefDocNo、RefDocItem、ParentItem
            const businessDataList = await cds.run(
                SELECT.from(DeliveryActualInfo)
                    .columns(['DeliveryDocument', 'DeliveryDocumentItem', 'RefDocNo', 'RefDocItem', 'ParentItem'])
                    .where({ zrfc_logid: zrfcLogid })
            );

            if (!businessDataList || businessDataList.length === 0) {
                console.warn('[updatePIDeliveryRel] 未找到业务表数据，zrfcLogid:', zrfcLogid);
                return;
            }

            console.log('[updatePIDeliveryRel] 找到业务数据:', businessDataList.length, '条');

            // 过滤出 RefDocNo 和 RefDocItem 不为空的数据
            const validBusinessData = businessDataList.filter(item => item.RefDocNo && item.RefDocItem);
            
            if (validBusinessData.length === 0) {
                console.warn('[updatePIDeliveryRel] 没有有效的 RefDocNo/RefDocItem 数据');
                return;
            }

            // 收集所有需要查询的 RefDocNo 和 RefDocItem（过滤空值）
            // 注意：PISalesOrderRel 的 PurchaseOrderItem 是5位，需要截取 RefDocItem 后5位来匹配
            const refDocNoList = [...new Set(validBusinessData.map(item => item.RefDocNo).filter(v => v))];
            const refDocItemList = [...new Set(validBusinessData.map(item => item.RefDocItem?.slice(-5)).filter(v => v))];

            if (refDocNoList.length === 0 || refDocItemList.length === 0) {
                console.warn('[updatePIDeliveryRel] RefDocNo 或 RefDocItem 为空，跳过更新');
                return;
            }

            // 构建业务数据映射，方便后续查找
            // 注意：使用 DeliveryDocument + DeliveryDocumentItem 作为 key
            const businessDataMap = new Map();
            validBusinessData.forEach(item => {
                const key = `${item.DeliveryDocument}-${item.DeliveryDocumentItem}`;
                businessDataMap.set(key, item);
            });

            // 批量查询 PISalesOrderRel，分别查询两个 PurchaseOrder 路径，然后合并结果
            let salesOrderRels = [];
            
            const result1 = await cds.run(
                SELECT.from(PISalesOrderRel)
                    .columns(['PIOrder', 'PIOrderItem', 'PurchaseOrder1', 'PurchaseOrderItem1', 'PurchaseOrder2', 'PurchaseOrderItem2'])
                    .where({
                        PurchaseOrder1: { in: refDocNoList },
                        PurchaseOrderItem1: { in: refDocItemList }
                    })
            );
            
            const result2 = await cds.run(
                SELECT.from(PISalesOrderRel)
                    .columns(['PIOrder', 'PIOrderItem', 'PurchaseOrder1', 'PurchaseOrderItem1', 'PurchaseOrder2', 'PurchaseOrderItem2'])
                    .where({
                        PurchaseOrder2: { in: refDocNoList },
                        PurchaseOrderItem2: { in: refDocItemList }
                    })
            );
            
            salesOrderRels = [...result1, ...result2];

            console.log('[updatePIDeliveryRel] 找到 PISalesOrderRel 记录:', salesOrderRels.length, '条');

            // 构建 PISalesOrderRel 映射
            const salesOrderRelMap = new Map();
            salesOrderRels.forEach(rel => {
                // 通过 PurchaseOrder1/PurchaseOrderItem1 映射
                if (rel.PurchaseOrder1 && rel.PurchaseOrderItem1) {
                    const key = `${rel.PurchaseOrder1}-${rel.PurchaseOrderItem1}`;
                    salesOrderRelMap.set(key, { PIOrder: rel.PIOrder, PIOrderItem: rel.PIOrderItem });
                }
                // 通过 PurchaseOrder2/PurchaseOrderItem2 映射（避免覆盖）
                if (rel.PurchaseOrder2 && rel.PurchaseOrderItem2) {
                    const key = `${rel.PurchaseOrder2}-${rel.PurchaseOrderItem2}`;
                    if (!salesOrderRelMap.has(key)) {
                        salesOrderRelMap.set(key, { PIOrder: rel.PIOrder, PIOrderItem: rel.PIOrderItem });
                    }
                }
            });

            // 收集所有需要查询的 PIOrder 和 PIOrderItem
            const piOrders = [];
            const piOrderItems = [];
            const businessToPiMap = new Map();

            // 使用 RefDocNo-RefDocItem 查找 salesOrderRelMap，建立 DeliveryDocument-DeliveryDocumentItem -> PI 信息的映射
            validBusinessData.forEach(item => {
                const lookupKey = `${item.RefDocNo}-${item.RefDocItem?.slice(-5)}`;
                const piInfo = salesOrderRelMap.get(lookupKey);
                const mapKey = `${item.DeliveryDocument}-${item.DeliveryDocumentItem}`;
                if (piInfo) {
                    piOrders.push(piInfo.PIOrder);
                    piOrderItems.push(piInfo.PIOrderItem);
                    businessToPiMap.set(mapKey, { ...piInfo, businessData: item });
                } else {
                    console.warn('[updatePIDeliveryRel] 未找到 PISalesOrderRel 记录，RefDocNo:', item.RefDocNo, 'RefDocItem:', item.RefDocItem);
                }
            });

            if (piOrders.length === 0) {
                console.warn('[updatePIDeliveryRel] 没有找到匹配的 PIOrder/PIOrderItem');
                return;
            }

            // 收集所有 DeliveryDocument 和 DeliveryDocumentItem
            const deliveryDocuments = [...new Set(validBusinessData.map(item => item.DeliveryDocument).filter(v => v))];
            const deliveryItems = [...new Set(validBusinessData.map(item => item.DeliveryDocumentItem).filter(v => v))];

            if (deliveryDocuments.length === 0 || deliveryItems.length === 0) {
                console.warn('[updatePIDeliveryRel] DeliveryDocument 或 DeliveryDocumentItem 为空，跳过更新');
                return;
            }

            // 批量查询 PIDeliveryRel（通过四个主键判断：PIOrder, PIOrderItem, DeliveryDocument, DeliveryDocumentItem）
            const existingRels = await cds.run(
                SELECT.from(PIDeliveryRel)
                    .where({
                        PIOrder: { in: piOrders },
                        PIOrderItem: { in: piOrderItems },
                        DeliveryDocument: { in: deliveryDocuments },
                        DeliveryDocumentItem: { in: deliveryItems }
                    })
            );

            console.log('[updatePIDeliveryRel] 找到已存在的 PIDeliveryRel 记录:', existingRels.length, '条');

            // 构建已存在记录的映射（使用四个主键：PIOrder, PIOrderItem, DeliveryDocument, DeliveryDocumentItem）
            const existingRelMap = new Map();
            existingRels.forEach(rel => {
                const key = `${rel.PIOrder}-${rel.PIOrderItem}-${rel.DeliveryDocument}-${rel.DeliveryDocumentItem}`;
                existingRelMap.set(key, rel);
            });

            // 处理内向交货单数据，构建 DeliveryDocument -> DeliveryDocumentItem[] 的映射
            const inboundDeliveryMap = new Map();
            inboundDeliveries.forEach(item => {
                const existing = inboundDeliveryMap.get(item.DeliveryDocument);
                if (existing) {
                    existing.push(item);
                } else {
                    inboundDeliveryMap.set(item.DeliveryDocument, [item]);
                }
            });

            // 查询内向交货单行项目以获取 ReferenceSDDocument
            const inboundDeliveryHeaders = [];
            for (const [deliveryDoc, items] of inboundDeliveryMap.entries()) {
                inboundDeliveryHeaders.push({ DeliveryDocument: deliveryDoc, items });
            }

            // 更新或插入 PIDeliveryRel
            for (const [businessKey, piInfo] of businessToPiMap) {
                const { PIOrder: piOrder, PIOrderItem: piOrderItem, businessData } = piInfo;
                const key = `${piOrder}-${piOrderItem}-${businessData?.DeliveryDocument}-${businessData?.DeliveryDocumentItem}`;
                const existingRel = existingRelMap.get(key);

                // 找到对应的内向交货单
                let inboundDelivery = null;
                for (const header of inboundDeliveryHeaders) {
                    const matchedItem = header.items.find(item => {
                        const refDocNo = businessData?.RefDocNo;
                        const refDocItem = businessData?.RefDocItem;
                        return item.ReferenceSDDocument === refDocNo && item.ReferenceSDDocumentItem === refDocItem;
                    });
                    if (matchedItem) {
                        inboundDelivery = { DeliveryDocument: header.DeliveryDocument, DeliveryDocumentItem: matchedItem.DeliveryDocumentItem };
                        break;
                    }
                }

                if (!inboundDelivery) {
                    console.warn('[updatePIDeliveryRel] 未找到匹配的内向交货单，PIOrder:', piOrder, 'PIOrderItem:', piOrderItem);
                    continue;
                }

                if (existingRel) {
                    // 更新
                    const updateData = {};

                    if (zrfcid === 'SD10' && canum === '10') {
                        updateData.InboundDeliveryNo2 = inboundDelivery.DeliveryDocument;
                        updateData.InboundDeliveryNoItem2 = inboundDelivery.DeliveryDocumentItem;
                    } else {
                        updateData.InboundDeliveryNo1 = inboundDelivery.DeliveryDocument;
                        updateData.InboundDeliveryNoItem1 = inboundDelivery.DeliveryDocumentItem;
                    }

                    if (Object.keys(updateData).length > 0) {
                        console.log('[updatePIDeliveryRel] UPDATE WHERE 条件，PIOrder:', piOrder, 'PIOrderItem:', piOrderItem, 'DeliveryDocument:', businessData?.DeliveryDocument, 'DeliveryDocumentItem:', businessData?.DeliveryDocumentItem);
                        await cds.run(
                            UPDATE(PIDeliveryRel)
                                .set(updateData)
                                .where({
                                    PIOrder: piOrder,
                                    PIOrderItem: piOrderItem,
                                    DeliveryDocument: businessData?.DeliveryDocument,
                                    DeliveryDocumentItem: businessData?.DeliveryDocumentItem
                                })
                        );
                        console.log('[updatePIDeliveryRel] 更新 PIDeliveryRel 成功，PIOrder:', piOrder, 'PIOrderItem:', piOrderItem, 'zrfcid:', zrfcid, 'canum:', canum);
                    }

                } else {
                    // 插入
                    const insertData = {
                        PIOrder: piOrder,
                        PIOrderItem: piOrderItem,
                        DeliveryDocument: businessData?.DeliveryDocument,
                        DeliveryDocumentItem: businessData?.DeliveryDocumentItem,
                        ParentItem: businessData?.ParentItem || '',
                        zrfc_logid: zrfcLogid
                    };

                    if (zrfcid === 'SD10' && canum === '10') {
                        insertData.InboundDeliveryNo2 = inboundDelivery.DeliveryDocument;
                        insertData.InboundDeliveryNoItem2 = inboundDelivery.DeliveryDocumentItem;
                    } else {
                        insertData.InboundDeliveryNo1 = inboundDelivery.DeliveryDocument;
                        insertData.InboundDeliveryNoItem1 = inboundDelivery.DeliveryDocumentItem;
                    }

                    await cds.run(
                        INSERT.into(PIDeliveryRel).entries(insertData)
                    );
                    console.log('[updatePIDeliveryRel] 插入 PIDeliveryRel 成功，PIOrder:', piOrder, 'PIOrderItem:', piOrderItem, 'zrfcid:', zrfcid, 'canum:', canum);
                }
            }

        } catch (error) {
            console.error('[updatePIDeliveryRel] 更新 PIDeliveryRel 失败:', error);
            throw error;
        }
    }

    parseError(data) {
        try {
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }
            return data?.error?.message?.value || data?.error?.innererr?.exception?.message || '未知错误';
        } catch (e) {
            return '解析错误信息失败';
        }
    }
}

module.exports = DeliveryOrderQueryService;