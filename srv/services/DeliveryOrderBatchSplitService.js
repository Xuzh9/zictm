const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const CommonUtils = require('../handlers/CommonUtils');

class DeliveryOrderBatchSplitService {
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

            console.log('[DeliveryOrderBatchSplitService] 开始执行, zrfcid:', zrfcid, 'canum:', canum, 'zdfjy:', zdfjy);

            // 读取 ProcessConfig 表获取业务表名（使用业务表1）
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid, true);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }
            console.log('[DeliveryOrderBatchSplitService] 业务表名:', businessTable);

            // 读取业务表数据（使用 zrfc_logid 查询）
            const businessDataList = await this.commonUtils.getBusinessData(businessTable, zrfcLogid, 'zrfc_logid');
            if (!businessDataList || businessDataList.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据，zrfc_logid: ${zrfcLogid}`,
                    objkey: ''
                };
            }

            // 使用通用工具类读取之前步骤的 objkey（交货单号）
            let deliveryDocument = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                deliveryDocument = previousObjkey;
            }

            if (!deliveryDocument) {
                return {
                    code: 'E',
                    message: '未找到交货单号',
                    objkey: ''
                };
            }
            console.log('[DeliveryOrderBatchSplitService] 交货单号:', deliveryDocument);

            // 构建 API 路径（参考 DeliveryOrderItemUpdateService 使用相对路径）
            const apiPath = '/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002';
            const apiUrl = `${apiPath}/A_OutbDeliveryHeader('${deliveryDocument}')?$expand=to_DeliveryDocumentItem`;
            const batchSplitAction = `${apiPath}/CreateBatchSplitItem`;

            // 获取 CSRF token 和交货单数据
            console.log('[DeliveryOrderBatchSplitService] 获取 CSRF token 和交货单数据:', apiUrl);
            const csrfResult = await this.commonUtils.executeHttpRequestWithRetry(
                { destinationName: this.commonUtils.getDestinationName() },
                {
                    method: 'GET',
                    url: apiUrl,
                    headers: {
                        'X-CSRF-Token': 'Fetch',
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            const csrfToken = csrfResult.headers['x-csrf-token'];
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            
            console.log('[DeliveryOrderBatchSplitService] CSRF token 获取成功:', csrfToken ? '是' : '否');

            if (csrfResult.status !== 200) {
                const errorMessage = this.parseError(csrfResult.data);
                console.error('[DeliveryOrderBatchSplitService] 获取交货单数据失败:', errorMessage);
                return {
                    code: 'E',
                    message: `获取交货单数据失败: ${errorMessage}`,
                    objkey: deliveryDocument
                };
            }

            // 解析交货单数据
            const resultData = typeof csrfResult.data === 'string' ? JSON.parse(csrfResult.data) : csrfResult.data;
            const deliveryItems = resultData?.d?.to_DeliveryDocumentItem?.results || [];
            
            console.log('[DeliveryOrderBatchSplitService] 交货单行项目数量:', deliveryItems.length);

            // 通过业务表的旧交货单号关联查询 PIDeliveryRel
            const PIDeliveryRel = cds.entities['com.sap.zictm.PIDeliveryRel'];

            // 收集业务数据的 DeliveryDocument（旧交货单号）和 DeliveryDocumentItem
            const deliveryDocuments = [...new Set(businessDataList.map(item => item.DeliveryDocument).filter(v => v))];
            const deliveryDocumentItems = [...new Set(businessDataList.map(item => item.DeliveryDocumentItem).filter(v => v))];

            // 查询 PIDeliveryRel 获取交货单与 PI 订单的关联
            let piDeliveryRels = [];
            if (deliveryDocuments.length > 0 && deliveryDocumentItems.length > 0) {
                piDeliveryRels = await cds.run(
                    SELECT.from(PIDeliveryRel).where({
                        DeliveryDocument: { in: deliveryDocuments },
                        DeliveryDocumentItem: { in: deliveryDocumentItems }
                    })
                );
            }

            console.log('[DeliveryOrderBatchSplitService] PIDeliveryRel 数据:', JSON.stringify(piDeliveryRels));

            // 构建 DeliveryDocument+DeliveryDocumentItem -> PI 订单的映射
            const deliveryToPiMap = new Map();
            piDeliveryRels.forEach(rel => {
                const key = `${rel.DeliveryDocument}-${rel.DeliveryDocumentItem}`;
                deliveryToPiMap.set(key, {
                    PIOrder: rel.PIOrder,
                    PIOrderItem: rel.PIOrderItem
                });
            });

            // 按旧交货单号过滤业务数据（主行+批次拆分行）
            const relevantBusinessData = businessDataList.filter(item =>
                item.DeliveryDocument === deliveryDocuments[0]
            );

            console.log('[DeliveryOrderBatchSplitService] 匹配到业务数据条数:', relevantBusinessData.length);

            // 交货单行项目按行号排序
            deliveryItems.sort((a, b) => (a.DeliveryDocumentItem || '').localeCompare(b.DeliveryDocumentItem || ''));

            // 循环处理交货单行项目
            for (const deliveryItem of deliveryItems) {
                const deliveryDocumentItem = deliveryItem.DeliveryDocumentItem;

                console.log('[DeliveryOrderBatchSplitService] 处理交货单行项目:',
                    'DeliveryDocument:', deliveryDocument,
                    'DeliveryDocumentItem:', deliveryDocumentItem);

                // 按 DeliveryDocumentItem 匹配业务数据（主行）
                const matchedBusinessData = relevantBusinessData.filter(item =>
                    item.DeliveryDocumentItem === deliveryDocumentItem
                );

                if (!matchedBusinessData || matchedBusinessData.length === 0) {
                    console.warn('[DeliveryOrderBatchSplitService] 未找到匹配的主行业务数据, DeliveryDocumentItem:', deliveryDocumentItem);
                    continue;
                }

                // 从 PIDeliveryRel 获取 PIOrder/PIOrderItem
                const piKey = `${matchedBusinessData[0].DeliveryDocument}-${deliveryDocumentItem}`;
                const piInfo = deliveryToPiMap.get(piKey);
                if (!piInfo) {
                    console.warn('[DeliveryOrderBatchSplitService] 未找到匹配的 PIDeliveryRel:', piKey);
                    continue;
                }

                // 过滤出 ParentItem 等于当前主行 DeliveryDocumentItem 的批次拆分数据，并按行号排序
                const batchSplitData = relevantBusinessData
                    .filter(item => item.ParentItem && item.ParentItem.trim() !== '' && item.ParentItem !== '000000' && item.ParentItem === deliveryDocumentItem)
                    .sort((a, b) => (a.DeliveryDocumentItem || '').localeCompare(b.DeliveryDocumentItem || ''));

                console.log('[DeliveryOrderBatchSplitService] 找到批次拆分数据:', batchSplitData.length, '条');

                // 如果没有批次拆分数据，跳过
                if (batchSplitData.length === 0) {
                    continue;
                }

                // 循环批次拆分数据，调用 /CreateBatchSplitItem（使用查询参数方式）
                for (const splitItem of batchSplitData) {
                    console.log('[DeliveryOrderBatchSplitService] 处理批次拆分项:', JSON.stringify(splitItem));

                    // 获取当前交货单行项目的 ETag
                    const itemUrl = `${apiPath}/A_OutbDeliveryItem(DeliveryDocument='${deliveryDocument}',DeliveryDocumentItem='${deliveryItem.DeliveryDocumentItem}')`;
                    let itemEtag = null;
                    try {
                        const itemResult = await this.commonUtils.executeHttpRequestWithRetry(
                            { destinationName: this.commonUtils.getDestinationName() },
                            {
                                method: 'GET',
                                url: itemUrl,
                                headers: {
                                    'X-CSRF-Token': csrfToken,
                                    'Cookie': cookieString,
                                    'sap-language': 'ZH'
                                },
                                validateStatus: function (status) {
                                    return true;
                                }
                            }
                        );
                        if (itemResult.status === 200) {
                            itemEtag = itemResult.headers['etag'] || itemResult.headers['Etag'];
                            console.log('[DeliveryOrderBatchSplitService] 获取行项目 ETag:', itemEtag);
                        }
                    } catch (error) {
                        console.warn('[DeliveryOrderBatchSplitService] 获取行项目 ETag 失败:', error.message);
                    }

                    // 构建查询参数（使用 deliveryItem 的数据）
                    const params = new URLSearchParams();
                    params.append("DeliveryDocument", `'${deliveryDocument}'`);
                    params.append("DeliveryDocumentItem", `'${deliveryItem.DeliveryDocumentItem}'`);
                    params.append("DeliveryQuantityUnit", `'${deliveryItem.DeliveryQuantityUnit || ''}'`);
                    params.append("ActualDeliveryQuantity", `${splitItem.ActualDeliveryQuantity || 0}M`);
                    params.append("Batch", `'${splitItem.Batch || ''}'`);

                    // 构建完整的 URL
                    const postUrl = `${batchSplitAction}?${params.toString()}`;
                    console.log('[DeliveryOrderBatchSplitService] POST URL:', postUrl);

                    // POST 调用 /CreateBatchSplitItem（需要 token 和 etag）
                    const createResult = await this.commonUtils.executeHttpRequestWithRetry(
                        { destinationName: this.commonUtils.getDestinationName() },
                        {
                            method: 'POST',
                            url: postUrl,
                            headers: {
                                'X-CSRF-Token': csrfToken,
                                'Cookie': cookieString,
                                'Accept': 'application/json',
                                'Content-Type': 'application/json',
                                'sap-language': 'ZH',
                                'If-Match': itemEtag || '*'
                            },
                            validateStatus: function (status) {
                                return true;
                            }
                        }
                    );

                    if (createResult.status >= 200 && createResult.status < 300) {
                        console.log('[DeliveryOrderBatchSplitService] 批次拆分项创建成功');
                    } else {
                        const errorMessage = this.parseError(createResult.data);
                        console.error('[DeliveryOrderBatchSplitService] 批次拆分项创建失败:', errorMessage);
                        return {
                            code: 'E',
                            message: `批次拆分失败: ${errorMessage}`,
                            objkey: deliveryDocument
                        };
                    }
                }
            }

            console.log('[DeliveryOrderBatchSplitService] 交货单批次拆分处理成功');
            
            const returnResult = {
                code: 'S',
                message: '交货单批次拆分处理成功',
                objkey: deliveryDocument
            };
            console.log('[DeliveryOrderBatchSplitService] 返回结果:', JSON.stringify(returnResult));
            return returnResult;

        } catch (error) {
            console.error('[DeliveryOrderBatchSplitService] 执行失败:', error);
            return {
                code: 'E',
                message: `交货单批次拆分失败: ${error.message}`,
                objkey: ''
            };
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
            return JSON.stringify(errorData.error.message);
        } else if (errorData?.message) {
            return errorData.message;
        } else {
            return JSON.stringify(errorData);
        }
    }
}

module.exports = DeliveryOrderBatchSplitService;