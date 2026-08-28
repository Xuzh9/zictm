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
            const RETRY_INTERVAL_MS = 30000;

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

                    if (zrfcid === 'SD05' || zrfcid === 'SD06') {
                        await this.updatePISalesOrderRel(salesOrder, zrfcLogid, zrfcid, responseData);
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

            const sapItems = responseData?._Item || responseData?.to_Item?.results || [];
            
            const sapItemMap = new Map();
            sapItems.forEach(item => {
                const product = item.Product || item.Material || '';
                if (product) {
                    if (!sapItemMap.has(product)) {
                        sapItemMap.set(product, []);
                    }
                    sapItemMap.get(product).push(item);
                }
            });

            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const { UPDATE, INSERT } = cds.ql;

            let updatedCount = 0;
            let insertedCount = 0;

            for (const item of businessData) {
                const material = (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') 
                    ? (item.Material || "") 
                    : (item.Product || "");
                
                if (!material) {
                    console.warn('[SalesOrderAsyncResultService.updatePISalesOrderRel] 业务数据物料号为空');
                    continue;
                }

                const matchedSapItems = sapItemMap.get(material);
                if (!matchedSapItems || matchedSapItems.length === 0) {
                    console.warn('[SalesOrderAsyncResultService.updatePISalesOrderRel] 未找到匹配的 SAP 行项目, 物料号:', material);
                    continue;
                }

                const sapItem = matchedSapItems.shift();
                const salesOrderItem = sapItem.SalesOrderItem || sapItem.CreditMemoRequestItem || sapItem.DebitMemoRequestItem || sapItem.CustomerReturnItem || '';

                const piOrder = item.PIOrder || '';
                const piOrderItem = item.PIOrderItem || '';
                
                if (piOrder && piOrderItem && salesOrder) {
                    const updateResult = await cds.run(
                        UPDATE(PISalesOrderRel)
                            .set({ SalesOrder: salesOrder, SalesOrderItem: String(salesOrderItem).padStart(6, '0') })
                            .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                    );
                    
                    console.log('[SalesOrderAsyncResultService.updatePISalesOrderRel] 更新结果:', updateResult);
                    
                    if (updateResult && (typeof updateResult !== 'number' || updateResult > 0)) {
                        updatedCount++;
                    } else {
                        console.log('[SalesOrderAsyncResultService.updatePISalesOrderRel] 未找到记录，执行插入');
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
                }
            }

            console.log(`[SalesOrderAsyncResultService.updatePISalesOrderRel] 更新完成, 更新: ${updatedCount} 条, 插入: ${insertedCount} 条`);

        } catch (error) {
            console.error('[SalesOrderAsyncResultService.updatePISalesOrderRel] 更新失败:', error);
        }
    }
}

module.exports = SalesOrderAsyncResultService;