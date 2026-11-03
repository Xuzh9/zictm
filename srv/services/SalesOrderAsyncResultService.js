const cds = require('@sap/cds');
const { UPDATE } = cds.ql;
const CommonUtils = require('../handlers/CommonUtils');

class SalesOrderAsyncResultService {
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
            const { zrfcid, canum, serviceName, readsteps, zrfcLogid, zdfjy } = inputData;
            let url = inputData.objkey;
            
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                url = previousObjkey;
            }
            
            this.zrfcLogid = zrfcLogid;

            console.log('[SalesOrderAsyncResultService] 开始执行, zrfcid:', zrfcid, 'url:', url);

            if (!url) {
                return {
                    code: 'E',
                    message: '异步URL为空',
                    objkey: ''
                };
            }

            const MAX_RETRIES = 20;
            const RETRY_INTERVAL_MS = 10000;

            for (let retryCount = 1; retryCount <= MAX_RETRIES; retryCount++) {
                console.log(`[SalesOrderAsyncResultService] 等待 ${RETRY_INTERVAL_MS / 1000} 秒后开始第 ${retryCount} 次获取...`);
                await this.sleep(RETRY_INTERVAL_MS);

                console.log(`[SalesOrderAsyncResultService] 第 ${retryCount} 次获取异步调用结果...`);
                console.log(`[SalesOrderAsyncResultService] 请求URL: ${url}`);
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

                if (result.status === 202) {
                    if (retryCount >= MAX_RETRIES) {
                        console.error('[SalesOrderAsyncResultService] 已达到最大重试次数，异步任务仍在处理中');
                        return {
                            code: 'E',
                            message: '异步任务处理超时，已达到最大重试次数',
                            objkey: ''
                        };
                    }
                    console.log(`[SalesOrderAsyncResultService] 异步任务仍在处理中`);
                    continue;
                } else if (result.status >= 200 && result.status < 300) {
                    const responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
                    
                    if (responseData?.error) {
                        const errorMessage = this.parseError(responseData);
                        console.error('[SalesOrderAsyncResultService] 异步调用失败:', errorMessage);
                        return {
                            code: 'E',
                            message: errorMessage,
                            objkey: ''
                        };
                    }

                    const salesOrder = responseData?.SalesOrder || responseData?.CustomerReturn || responseData?.DebitMemoRequest || responseData?.CreditMemoRequest || '';

                    console.log('[SalesOrderAsyncResultService] 异步调用成功, 销售订单:', salesOrder);

                    // 保护：如果 salesOrder 为空，说明 SAP 没有返回有效数据（监控器失效/返回200但body是空/非结构化错误），视为失败
                    if (!salesOrder) {
                        const errorMessage = this.parseError(responseData) || `无有效销售订单数据`;
                        console.error('[SalesOrderAsyncResultService] 无有效销售订单:', errorMessage);
                        return {
                            code: 'E',
                            message: errorMessage,
                            objkey: ''
                        };
                    }

                    switch (zrfcid) {
                        case 'SD05':
                        case 'SD06':
                        case 'SD12':
                            await this.updatePISalesOrderRel(salesOrder, zrfcLogid, zrfcid, responseData);
                            break;
                        case 'SD02':
                        case 'SD04':
                        case 'SD11':
                            // 更新数帝单据关系表的对外销售订单号和行号
                            await this.updateSDDocRel(salesOrder, zrfcLogid, zrfcid, responseData);
                            break;
                    }

                    return {
                        code: 'S',
                        message: '销售订单创建成功',
                        objkey: salesOrder
                    };
                } else {
                    const errorMessage = this.parseError(result.data);
                    console.error('[SalesOrderAsyncResultService] 获取异步结果失败:', errorMessage);
                    return {
                        code: 'E',
                        message: errorMessage,
                        objkey: ''
                    };
                }
            }

        } catch (error) {
            console.error('[SalesOrderAsyncResultService] 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '获取异步结果失败',
                objkey: ''
            };
        }
    }

    // 物料号归一化：去空格、去前导零（与项目其他服务口径一致）
    normalizeMaterial(material) {
        return String(material || '').trim().replace(/^0+/, '');
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

        const messages = [];

        if (errorData?.error?.message) {
            messages.push(errorData.error.message);
        } else if (errorData?.error?.message?.value) {
            messages.push(errorData.error.message.value);
        } else if (errorData?.message) {
            messages.push(errorData.message);
        }

        if (errorData?.error?.details && Array.isArray(errorData.error.details)) {
            errorData.error.details.forEach(detail => {
                if (detail?.message) {
                    messages.push(detail.message);
                }
            });
        }

        if (errorData?.error?.innererror?.errordetails && Array.isArray(errorData.error.innererror.errordetails)) {
            errorData.error.innererror.errordetails.forEach(detail => {
                if (detail?.message) {
                    messages.push(detail.message);
                }
            });
        }

        if (messages.length > 0) {
            return messages.join('; ');
        } else {
            return JSON.stringify(errorData);
        }
    }

    async updatePISalesOrderRel(salesOrder, zrfcLogid, zrfcid, responseData) {
        try {
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const config = await cds.run(
                SELECT.one.from(ProcessConfig)
                    .where({ zrfcid: zrfcid })
            );

            if (!config || !config.businessTable1) {
                console.warn('[SalesOrderAsyncResultService.updatePISalesOrderRel] 未找到业务表配置');
                return;
            }

            const businessTable = config.businessTable1;
            const entity = cds.entities[`com.sap.zictm.${businessTable}`];
            
            if (!entity) {
                console.warn('[SalesOrderAsyncResultService.updatePISalesOrderRel] 业务表不存在:', businessTable);
                return;
            }

            const businessData = await cds.run(
                SELECT.from(entity)
                    .where({ zrfc_logid: zrfcLogid })
            );

            if (!businessData || businessData.length === 0) {
                console.warn('[SalesOrderAsyncResultService.updatePISalesOrderRel] 未找到业务数据');
                return;
            }

            // 异步监控接口返回的 _Item 通常不带行项目（或只含部分行，例如服务类物料行缺失），
            // 因此统一按销售订单号回查行项目，保证业务表每一行都能匹配到
            let sapItems = await this.getSalesOrderItemsFromAPI(salesOrder);
            if (!sapItems || sapItems.length === 0) {
                sapItems = this.extractItemsFromResponse(responseData);
                console.log('[SalesOrderAsyncResultService.updatePISalesOrderRel] 回查行项目为空，改用异步返回数据, 行数:', sapItems.length);
            }
            console.log(`[SalesOrderAsyncResultService.updatePISalesOrderRel] SAP 行项目数: ${sapItems.length}, 物料: ${sapItems.map(i => i.Product || i.Material || '').join(',')}, zrfcid: ${zrfcid}, zrfcLogid: ${zrfcLogid}`);
            
            // SAP 行项目按归一化物料号做一对一映射（业务上同一销售订单不会同物料多行）
            const sapItemMap = new Map();
            sapItems.forEach(item => {
                const normalizedKey = this.normalizeMaterial(item.Product || item.Material || '');
                if (normalizedKey && !sapItemMap.has(normalizedKey)) {
                    sapItemMap.set(normalizedKey, item);
                }
            });

            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const { UPDATE, INSERT } = cds.ql;

            let updatedCount = 0;
            let insertedCount = 0;

            for (const item of businessData) {
                const rawMaterial = (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06' || zrfcid === 'SD12')
                    ? (item.Material || "")
                    : (item.Product || "");
                const material = this.normalizeMaterial(rawMaterial);
                
                console.log(`[SalesOrderAsyncResultService.updatePISalesOrderRel] 业务行: PIOrder='${item.PIOrder}', PIOrderItem='${item.PIOrderItem}', 原始物料='${rawMaterial}', 归一化='${material}'`);

                if (!material) {
                    console.warn('[SalesOrderAsyncResultService.updatePISalesOrderRel] 业务数据物料号为空');
                    continue;
                }

                const sapItem = sapItemMap.get(material);
                if (!sapItem) {
                    console.warn('[SalesOrderAsyncResultService.updatePISalesOrderRel] 未找到匹配的 SAP 行项目, 物料号:', material);
                    continue;
                }
                const salesOrderItem = sapItem.SalesOrderItem || sapItem.CreditMemoRequestItem || sapItem.DebitMemoRequestItem || sapItem.CustomerReturnItem || '';

                const piOrder = item.PIOrder || '';
                const piOrderItem = item.PIOrderItem || '';
                
                console.log(`[SalesOrderAsyncResultService.updatePISalesOrderRel] 匹配成功: 物料=${material}, SAP行号=${salesOrderItem}, piOrder=${piOrder}, piOrderItem=${piOrderItem}`);

                if (piOrder && piOrderItem && salesOrder) {
                    // SD12 写 SalesOrder/SalesOrderItem（对外销售订单字段），同时更新 zrfc_logid 归属
                    const setData = { SalesOrder: salesOrder, SalesOrderItem: String(salesOrderItem).padStart(6, '0'), zrfc_logid: zrfcLogid };
                    const whereData = { PIOrder: piOrder, PIOrderItem: piOrderItem };
                    console.log(`[SalesOrderAsyncResultService.updatePISalesOrderRel] 执行UPDATE: where=${JSON.stringify(whereData)}, set=${JSON.stringify(setData)}`);
                    const updateResult = await cds.run(
                        UPDATE(PISalesOrderRel).set(setData).where(whereData)
                    );
                    
                    console.log('[SalesOrderAsyncResultService.updatePISalesOrderRel] UPDATE结果:', updateResult);
                    
                    if (this.getAffectedRows(updateResult) > 0) {
                        updatedCount++;
                    } else {
                        console.log('[SalesOrderAsyncResultService.updatePISalesOrderRel] 未找到记录，执行插入, PIOrder=', piOrder, 'PIOrderItem=', piOrderItem);
                        const insertResult = await cds.run(
                            INSERT.into(PISalesOrderRel)
                                .entries({
                                    PIOrder: piOrder,
                                    PIOrderItem: piOrderItem,
                                    zrfc_logid: zrfcLogid,
                                    SalesOrder: salesOrder,
                                    SalesOrderItem: String(salesOrderItem).padStart(6, '0')
                                })
                        );
                        console.log('[SalesOrderAsyncResultService.updatePISalesOrderRel] 插入结果:', insertResult);
                        insertedCount++;
                    }
                } else {
                    console.warn(`[SalesOrderAsyncResultService.updatePISalesOrderRel] 业务数据 PIOrder/PIOrderItem 为空，跳过, PIOrder: ${piOrder}, PIOrderItem: ${piOrderItem}, 物料号: ${material}`);
                }
            }

            console.log(`[SalesOrderAsyncResultService.updatePISalesOrderRel] 更新完成, 更新: ${updatedCount} 条, 插入: ${insertedCount} 条`);

        } catch (error) {
            console.error('[SalesOrderAsyncResultService.updatePISalesOrderRel] 更新失败:', error);
        }
    }

    // UPDATE 返回值的受影响行数：HANA 返回 { affectedRows: N }，部分数据库返回数字
    getAffectedRows(result) {
        if (typeof result === 'number') return result;
        if (!result) return 0;
        if (typeof result.affectedRows === 'number') return result.affectedRows;
        // 返回对象但无 affectedRows 时视为更新成功，兼容不同数据库驱动
        return 1;
    }

    // 从异步监控接口返回中提取行项目（OData V4：_Item；V2：to_Item.results）
    extractItemsFromResponse(responseData) {
        const v4Items = responseData?._Item;
        if (Array.isArray(v4Items)) return v4Items;
        if (Array.isArray(v4Items?.results)) return v4Items.results;

        const v2Items = responseData?.to_Item;
        if (Array.isArray(v2Items?.results)) return v2Items.results;
        if (Array.isArray(v2Items)) return v2Items;

        return [];
    }

    /**
     * 按销售订单号回查行项目
     * 异步监控接口返回的 _Item 常常不带行项目或只含部分行（服务类物料行缺失），
     * 这里直接查 V2 接口 to_Item，拿到全部行项目
     */
    async getSalesOrderItemsFromAPI(salesOrderNumber) {
        if (!salesOrderNumber) return [];
        try {
            const itemUrl = `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder('${salesOrderNumber}')/to_Item`;
            console.log('[SalesOrderAsyncResultService] 回查销售订单行项目 URL:', itemUrl);

            const response = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'GET',
                    url: itemUrl,
                    headers: {
                        'Accept': 'application/json',
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            if (response.status < 200 || response.status >= 300) {
                console.error(`[SalesOrderAsyncResultService] 获取销售订单 ${salesOrderNumber} 行项目失败，状态码: ${response.status}，响应: ${JSON.stringify(response.data).substring(0, 500)}`);
                return [];
            }

            const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
            const items = data?.d?.results || [];
            console.log(`[SalesOrderAsyncResultService] 获取销售订单 ${salesOrderNumber} 行项目 ${items.length} 条`);
            return items;
        } catch (error) {
            console.error('[SalesOrderAsyncResultService] 获取销售订单行项目异常:', error.message);
            return [];
        }
    }

    /**
     * SD02/SD04：更新数帝单据关系表 SDDocRel 的对外销售订单号/行号（无记录则新增）
     * 以业务表主键 SalesOrder + SalesOrderItem 为键，通过物料号匹配 SAP 返回行项目获取对外销售订单行号
     */
    async updateSDDocRel(salesOrder, zrfcLogid, zrfcid, responseData) {
        try {
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const config = await cds.run(
                SELECT.one.from(ProcessConfig)
                    .where({ zrfcid: zrfcid })
            );

            if (!config || !config.businessTable1) {
                console.warn('[SalesOrderAsyncResultService.updateSDDocRel] 未找到业务表配置');
                return;
            }

            const entity = cds.entities[`com.sap.zictm.${config.businessTable1}`];
            if (!entity) {
                console.warn('[SalesOrderAsyncResultService.updateSDDocRel] 业务表不存在:', config.businessTable1);
                return;
            }

            const businessData = await cds.run(
                SELECT.from(entity)
                    .where({ zrfc_logid: zrfcLogid })
            );

            if (!businessData || businessData.length === 0) {
                console.warn('[SalesOrderAsyncResultService.updateSDDocRel] 未找到业务数据');
                return;
            }

            // SAP 返回行项目按归一化物料号做一对一映射
            // 同样不依赖异步监控返回的行项目，按销售订单号回查，避免服务类物料行缺失
            let sapItems = await this.getSalesOrderItemsFromAPI(salesOrder);
            if (!sapItems || sapItems.length === 0) {
                sapItems = this.extractItemsFromResponse(responseData);
            }
            console.log(`[SalesOrderAsyncResultService.updateSDDocRel] SAP 行项目数: ${sapItems.length}, 物料: ${sapItems.map(i => i.Product || i.Material || '').join(',')}`);
            const sapItemMap = new Map();
            sapItems.forEach(item => {
                const normalizedKey = this.normalizeMaterial(item.Product || item.Material);
                if (normalizedKey && !sapItemMap.has(normalizedKey)) {
                    sapItemMap.set(normalizedKey, item);
                }
            });

            const SDDocRel = cds.entities['com.sap.zictm.SDDocRel'];
            const { UPDATE, INSERT } = cds.ql;

            let updatedCount = 0;
            let insertedCount = 0;

            for (const item of businessData) {
                const material = this.normalizeMaterial(item.Product || item.Material);
                if (!material) {
                    console.warn('[SalesOrderAsyncResultService.updateSDDocRel] 业务数据物料号为空');
                    continue;
                }

                const sapItem = sapItemMap.get(material);
                if (!sapItem) {
                    console.warn('[SalesOrderAsyncResultService.updateSDDocRel] 未找到匹配的 SAP 行项目, 物料号:', material);
                    continue;
                }
                const externalSalesOrderItem = sapItem.SalesOrderItem || sapItem.CreditMemoRequestItem || sapItem.DebitMemoRequestItem || sapItem.CustomerReturnItem || '';

                const docSalesOrder = item.SalesOrder || '';
                const docSalesOrderItem = item.SalesOrderItem || '';

                if (!docSalesOrder || !docSalesOrderItem) {
                    console.warn('[SalesOrderAsyncResultService.updateSDDocRel] 业务数据主键为空，跳过');
                    continue;
                }

                const updateResult = await cds.run(
                    UPDATE(SDDocRel)
                        .set({ ExternalSalesOrder: salesOrder, ExternalSalesOrderItem: String(externalSalesOrderItem).padStart(6, '0') })
                        .where({ SalesOrder: docSalesOrder, SalesOrderItem: docSalesOrderItem })
                );

                if (this.getAffectedRows(updateResult) > 0) {
                    updatedCount++;
                } else {
                    console.log('[SalesOrderAsyncResultService.updateSDDocRel] 未找到记录，执行插入');
                    await cds.run(
                        INSERT.into(SDDocRel)
                            .entries({
                                SalesOrder: docSalesOrder,
                                SalesOrderItem: docSalesOrderItem,
                                ExternalSalesOrder: salesOrder,
                                ExternalSalesOrderItem: String(externalSalesOrderItem).padStart(6, '0'),
                                zrfcid: zrfcid,
                                zrfc_logid: zrfcLogid
                            })
                    );
                    insertedCount++;
                }
            }

            console.log(`[SalesOrderAsyncResultService.updateSDDocRel] 更新完成, 更新: ${updatedCount} 条, 插入: ${insertedCount} 条`);

        } catch (error) {
            console.error('[SalesOrderAsyncResultService.updateSDDocRel] 更新失败:', error);
        }
    }
}

module.exports = SalesOrderAsyncResultService;