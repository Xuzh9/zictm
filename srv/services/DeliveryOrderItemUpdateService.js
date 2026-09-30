const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const CommonUtils = require('../handlers/CommonUtils');

class DeliveryOrderItemUpdateService {
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

            console.log('[DeliveryOrderItemUpdateService] 开始执行, zrfcid:', zrfcid, 'canum:', canum, 'zdfjy:', zdfjy);

            // 读取 ProcessConfig 表获取业务表名（使用业务表1）
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid, true);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }
            console.log('[DeliveryOrderItemUpdateService] 业务表名:', businessTable);

            // 读取业务表数据（使用 zrfc_logid 查询）
            const businessDataAll = await this.commonUtils.getBusinessData(businessTable, zrfcLogid, 'zrfc_logid');
            if (!businessDataAll || businessDataAll.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据，zrfc_logid: ${zrfcLogid}`,
                    objkey: ''
                };
            }

            // 过滤掉批次拆分行（ParentItem 非空且不为 '000000'），此时交货单只有主行，批次拆分在后续步骤处理
            const businessDataList = businessDataAll.filter(item =>
                !item.ParentItem || item.ParentItem.trim() === '' || item.ParentItem === '000000'
            );
            console.log(`[DeliveryOrderItemUpdateService] 业务数据共 ${businessDataAll.length} 条，过滤批次拆分行后主行 ${businessDataList.length} 条`);
            if (!businessDataList || businessDataList.length === 0) {
                return {
                    code: 'E',
                    message: `过滤批次拆分行后无主行数据，zrfc_logid: ${zrfcLogid}`,
                    objkey: ''
                };
            }
           
            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 使用通用工具类读取之前步骤的 objkey（交货单号）
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);

            // 获取销售订单类型（SD07/SD11 80 及 SD10 从 PIDeliveryRel 获取，其他从业务表获取）
            let salesOrderType;
            if ((zrfcid === 'SD07' && canum === 80) || zrfcid === 'SD10' || (zrfcid === 'SD11' && canum === 80)) {
                try {
                    const PIDeliveryRel = cds.entities['com.sap.zictm.PIDeliveryRel'];
                    const { SELECT } = cds.ql;
                    const piDeliveryRel = await cds.run(
                        SELECT.from(PIDeliveryRel)
                            .columns(['SalesOrderType'])
                            .where({
                                DeliveryDocument: businessDataList[0].DeliveryDocument,
                                DeliveryDocumentItem: businessDataList[0].DeliveryDocumentItem
                            })
                            .limit(1)
                    );
                    if (piDeliveryRel && piDeliveryRel.length > 0) {
                        salesOrderType = piDeliveryRel[0].SalesOrderType;
                    }
                } catch (error) {
                    console.error('[DeliveryOrderItemUpdateService] 查询 PIDeliveryRel 失败:', error);
                }
            } else {
                salesOrderType = businessDataList[0]?.SalesOrderType;
            }
            console.log(`[DeliveryOrderItemUpdateService] 销售订单类型: ${salesOrderType}`);

            // 借贷项订单（CR/DR）不需要交货单操作，直接跳过
            if (salesOrderType === 'CR' || salesOrderType === 'DR') {
                console.log(`[DeliveryOrderItemUpdateService] 销售订单类型 ${salesOrderType} 为借贷项订单，步骤跳过`);
                const returnResult = {
                    code: 'S',
                    message: `销售订单类型 ${salesOrderType} 为借贷项订单，跳过交货单行项目修改`,
                    objkey: ''
                };
                console.log('[DeliveryOrderItemUpdateService] 返回结果:', JSON.stringify(returnResult));
                return returnResult;
            }

            // 获取交货单号（从 objkey 或业务数据中获取）
            const deliveryDocument = previousObjkey || businessDataList[0]?.DeliveryDocument || '';
            if (!deliveryDocument) {
                return {
                    code: 'E',
                    message: '未找到交货单号',
                    objkey: ''
                };
            }
            console.log('[DeliveryOrderItemUpdateService] 交货单号:', deliveryDocument);

            // 根据 zrfcid、canum 和销售订单类型判断使用的 API 路径
            let apiPath;
            let itemEntity;
            let isInboundDelivery = false; // 新增：标识是否为内向交货单
            
            if ((zrfcid === 'SD04' && canum === 120) || 
                (zrfcid === 'SD07' && canum === 30) || 
                zrfcid === 'SD09' || 
                (zrfcid === 'SD10' && (canum === 30 || canum === 130)) ||
                (zrfcid === 'SD11' && canum === 160)) {
                apiPath = '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV;v=0002';
                itemEntity = 'A_InbDeliveryItem';
                isInboundDelivery = true; // 设置为内向交货单
            } else if (((zrfcid === 'SD11' && canum === 80) || (zrfcid === 'SD07' && canum === 80)) && salesOrderType === 'CBRE') {
                apiPath = '/sap/opu/odata/sap/API_CUSTOMER_RETURNS_DELIVERY_SRV;v=2';
                itemEntity = 'A_ReturnsDeliveryItem';
            } else {
                apiPath = '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002';
                itemEntity = 'A_OutbDeliveryItem';
            }
            console.log('[DeliveryOrderItemUpdateService] API 路径:', apiPath, '实体:', itemEntity);

            let csrfToken = null;
            let cookieString = null;

            // 获取 CSRF token（只获取一次）
            const firstBusinessData = businessDataList.find(bd => bd.SalesOrderItem || bd.DeliveryDocumentItem);
            if (firstBusinessData) {
                const firstItemUrl = `${apiPath}/${itemEntity}(DeliveryDocument='${deliveryDocument}',DeliveryDocumentItem='${firstBusinessData.SalesOrderItem || firstBusinessData.DeliveryDocumentItem}')`;
                console.log('[DeliveryOrderItemUpdateService] 获取 CSRF token:', firstItemUrl);
                const csrfResult = await this.commonUtils.executeHttpRequestWithRetry(
                    {
                        destinationName: this.commonUtils.getDestinationName()
                    },
                    {
                        method: 'GET',
                        url: firstItemUrl,
                        headers: {
                            'X-CSRF-Token': 'Fetch',
                            'sap-language': 'ZH'
                        },
                        validateStatus: function (status) {
                            return true;
                        }
                    }
                );
                csrfToken = csrfResult.headers['x-csrf-token'];
                cookieString = csrfResult.headers['set-cookie'] ? csrfResult.headers['set-cookie'].join('; ') : '';
                console.log('[DeliveryOrderItemUpdateService] CSRF token 获取成功:', csrfToken);

                // 检查货物移动状态，如果为 C（已过帐）则跳过本步骤
                const responseData = csrfResult.data?.d || csrfResult.data || {};
                const itemResults = responseData.results || [responseData];
                const goodsMovementStatus = itemResults[0]?.GoodsMovementStatus || '';
                console.log(`[DeliveryOrderItemUpdateService] 货物移动状态: ${goodsMovementStatus}`);
                if (goodsMovementStatus === 'C') {
                    console.log('[DeliveryOrderItemUpdateService] 货物移动状态为 C（已过帐），跳过行项目修改');
                    const returnResult = {
                        code: 'S',
                        message: '货物移动状态为 C（已过帐），跳过交货单行项目修改',
                        objkey: deliveryDocument
                    };
                    console.log('[DeliveryOrderItemUpdateService] 返回结果:', JSON.stringify(returnResult));
                    return returnResult;
                }
            }

            // 循环更新每个行项目
            for (const businessData of businessDataList) {
                // 销售订单行项目类型/类别为 TAD 时跳过（文本/服务行无交货单行项目）
                const itemTypeOrCategory = businessData.SalesOrderItemType || businessData.SalesOrderItemCategory || '';
                if (itemTypeOrCategory === 'TAD') {
                    console.log(`[DeliveryOrderItemUpdateService] 跳过 TAD 行: DeliveryDocument=${businessData.DeliveryDocument}, DeliveryDocumentItem=${businessData.DeliveryDocumentItem}`);
                    continue;
                }

                const deliveryDocumentItem = businessData.SalesOrderItem || businessData.DeliveryDocumentItem || '';
                
                if (!deliveryDocumentItem) {
                    console.warn('[DeliveryOrderItemUpdateService] 跳过空行项目');
                    continue;
                }

                // 构建更新 URL
                const itemUrl = `${apiPath}/${itemEntity}(DeliveryDocument='${deliveryDocument}',DeliveryDocumentItem='${deliveryDocumentItem}')`;

                // 构建更新数据
                const updateData = {};

                // 仅 SD07 80 和 SD10 80 步骤需要批次拆分数量更新
                if ((zrfcid === 'SD07' && canum === 80) || (zrfcid === 'SD10' && canum === 80)) {
                    // 如果该主行存在批次拆分行，先将交货数量更新为批次拆分行数量之和（后续批次拆分步骤再拆分）
                    const mainItemKey = businessData.DeliveryDocumentItem || businessData.SalesOrderItem;
                    const splitRows = businessDataAll.filter(item =>
                        item.ParentItem && item.ParentItem.trim() !== '' && item.ParentItem !== '000000' &&
                        item.ParentItem === mainItemKey
                    );
                    if (splitRows.length > 0) {
                        const splitTotal = splitRows.reduce((sum, r) => sum + (Number(r.ActualDeliveryQuantity) || 0), 0);
                        if (splitTotal > 0) {
                            // 以字符串传输
                            updateData.ActualDeliveryQuantity = String(splitTotal);
                            console.log(`[DeliveryOrderItemUpdateService] 主行 ${deliveryDocumentItem} 存在 ${splitRows.length} 条批次拆分行，交货数量更新为: ${splitTotal}`);
                        }
                    }
                }

                // 更新 Batch（内向交货单、SD07/SD10 80 不需要更新）
                if (!isInboundDelivery && !((zrfcid === 'SD07' && canum === 80) || (zrfcid === 'SD10' && canum === 80))) {
                    updateData.Batch = '2025';
                }
                
                // 更新 StorageLocation（仅外向交货单）
                if (!isInboundDelivery) {
                    if ((zrfcid === 'SD07' && canum === 80) || (zrfcid === 'SD10' && canum === 80)) {
                        // SD07/SD10 80：根据采购订单行项目查询库存地点
                        if (businessData.RefDocNo && businessData.RefDocItem) {
                            const refDocItemLast5 = businessData.RefDocItem.slice(-5);
                            const poStorageLocation = await this.getPurchaseOrderStorageLocation(businessData.RefDocNo, refDocItemLast5);
                            if (poStorageLocation) {
                                updateData.StorageLocation = poStorageLocation;
                            }
                        }
                    } else if (zrfcid === 'SD04' && canum === 80) {
                        // SD04 80：取业务表的收货库存地点
                        if (businessData.ReceivingStorageLocation || businessData.StorageLocation) {
                            updateData.StorageLocation = businessData.ReceivingStorageLocation || businessData.StorageLocation;
                        }
                    }
                }

                if (Object.keys(updateData).length === 0) {
                    console.warn('[DeliveryOrderItemUpdateService] 没有需要更新的字段，跳过行项目:', deliveryDocumentItem);
                    continue;
                }

                console.log('[DeliveryOrderItemUpdateService] 更新数据:', JSON.stringify(updateData));

                // 带重试的 PATCH（SAP 交货单锁可能未立即释放，防止"正由处理另一个用户处理"）
                const maxAttempts = 3;
                let patchSuccess = false;
                let patchErrorMessage = '';

                for (let attempt = 1; attempt <= maxAttempts && !patchSuccess; attempt++) {
                    if (attempt > 1) {
                        const delay = 1000 * attempt;
                        console.warn(`[DeliveryOrderItemUpdateService] 等待 ${delay}ms 后重试 PATCH (尝试 ${attempt}/${maxAttempts}) 行项目: ${deliveryDocumentItem}`);
                        await this.sleep(delay);
                    }

                    // PATCH 更新行项目
                    const patchResult = await this.commonUtils.executeHttpRequestWithRetry(
                        {
                            destinationName: this.commonUtils.getDestinationName()
                        },
                        {
                            method: 'PATCH',
                            url: itemUrl,
                            headers: {
                                'X-CSRF-Token': csrfToken,
                                'Cookie': cookieString,
                                'Accept': 'application/json',
                                'sap-language': 'ZH',
                                'If-Match': '*'
                            },
                            data: updateData,
                            validateStatus: function (status) {
                                return true;
                            }
                        }
                    );

                    if (patchResult.status === 204 || (patchResult.data && !patchResult.data.error)) {
                        patchSuccess = true;
                        console.log('[DeliveryOrderItemUpdateService] 行项目修改成功:', deliveryDocumentItem);
                        // 成功后短暂等待，让 SAP 释放交货单锁，避免影响下一个行项目
                        await this.sleep(500);
                    } else {
                        patchErrorMessage = this.parseError(patchResult.data);
                        console.error(`[DeliveryOrderItemUpdateService] 行项目修改失败 (尝试 ${attempt}/${maxAttempts}): ${deliveryDocumentItem} ${patchErrorMessage}`);
                    }
                }

                if (!patchSuccess) {
                    return {
                        code: 'E',
                        message: `行项目 ${deliveryDocumentItem} 修改失败: ${patchErrorMessage}`,
                        objkey: deliveryDocument
                    };
                }
            }

            console.log('[DeliveryOrderItemUpdateService] 交货单行项目修改成功');
            
            const returnResult = {
                code: 'S',
                message: '交货单行项目修改成功',
                objkey: deliveryDocument
            };
            console.log('[DeliveryOrderItemUpdateService] 返回结果:', JSON.stringify(returnResult));
            return returnResult;

        } catch (error) {
            console.error('[DeliveryOrderItemUpdateService] 执行失败:', error);
            return {
                code: 'E',
                message: `交货单行项目修改失败: ${error.message}`,
                objkey: ''
            };
        }
    }

    async getPurchaseOrderStorageLocation(purchaseOrder, itemDeliveryAddress) {
        try {
            const poUrl = `/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrderItem/${purchaseOrder}/${itemDeliveryAddress}`;
            console.log(`[DeliveryOrderItemUpdateService] 获取采购订单库存地点: ${poUrl}`);

            const result = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'GET',
                    url: poUrl,
                    headers: {
                        'Accept': 'application/json',
                        'sap-language': 'ZH'
                    }
                }
            );

            if (result.data?.StorageLocation) {
                const storageLocation = result.data.StorageLocation;
                console.log(`[DeliveryOrderItemUpdateService] 获取到 StorageLocation: ${storageLocation}`);
                return storageLocation;
            }
            console.warn(`[DeliveryOrderItemUpdateService] 未获取到 StorageLocation`);
            return null;
        } catch (error) {
            console.error('[DeliveryOrderItemUpdateService] 获取采购订单库存地点失败:', error);
            return null;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
            return JSON.stringify(errorData.error.message);
        } else if (errorData?.message) {
            return errorData.message;
        } else {
            return JSON.stringify(errorData);
        }
    }
}

module.exports = DeliveryOrderItemUpdateService;