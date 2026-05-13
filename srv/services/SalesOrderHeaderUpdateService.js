const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class SalesOrderHeaderUpdateService {
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

            // 检查是否需要跳过此步骤
            const skipResult = await this.checkSkipCondition(zrfcid, canum, piSalesOrderRelRecords);
            if (skipResult) {
                return skipResult;
            }

            // 根据业务类型动态选择销售订单号（优先使用动态获取的订单号）
            let salesOrder = this.getSalesOrderByType(zrfcid, canum, piSalesOrderRelRecords);
            
            // 如果动态获取失败，回退到 objkey 或前一步骤的 objkey
            if (!salesOrder) {
                salesOrder = objkey;
                const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
                if (previousObjkey) {
                    salesOrder = previousObjkey;
                }
            }

            // 如果最终还是没有销售订单号，返回跳过状态
            if (!salesOrder) {
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

            // 构建销售订单抬头修改数据
            const headerData = this.buildHeaderData(businessDataList, mptStepConfig);
            
            // 如果没有需要更新的字段，跳过此步骤
            if (Object.keys(headerData).length === 0) {
                console.log('销售订单抬头没有需要更新的字段，步骤跳过');
                return {
                    code: 'S',
                    message: '销售订单抬头没有需要更新的字段，步骤跳过',
                    objkey: salesOrder
                };
            }

            // 获取 CSRF token 和 ETag（使用 OData V2 格式）
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder('${salesOrder}')`,
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
            
            console.log('开始修改销售订单抬头:', salesOrder);
            console.log('修改数据:', JSON.stringify(headerData, null, 2));

            // 调用销售订单修改 API（OData V2 格式）
            const result = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'PATCH',
                    url: `/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder('${salesOrder}')`,
                    data: headerData,
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        'Content-Type': 'application/json',
                        'Cookie': cookieString,
                        'sap-language': 'ZH',
                        'If-Match': etag || '*'
                    },
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            console.log('修改状态码:', result.status);
            console.log('修改响应数据:', JSON.stringify(result.data, null, 2));

            if (result.status >= 200 && result.status < 300) {
                console.log('销售订单抬头修改成功');
                return {
                    code: 'S',
                    message: '销售订单抬头修改成功',
                    objkey: salesOrder
                };
            } else {
                const errorMessage = this.parseError(result.data);
                console.error('销售订单抬头修改失败:', errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('SalesOrderHeaderUpdateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '销售订单抬头修改失败',
                objkey: ''
            };
        }
    }

    buildHeaderData(businessDataList, mptStepConfig) {
        const firstBusinessData = businessDataList[0];
        const headerData = {};
        
        // 只有当字段有值时才添加到更新对象中
        if (firstBusinessData.YY1_FD_XMYQ) {
            headerData.YY1_FD_XMYQ_SDH = firstBusinessData.YY1_FD_XMYQ;
        }
        if (firstBusinessData.YY1_FD_DBFS) {
            headerData.YY1_FD_DBFS_SDH = firstBusinessData.YY1_FD_DBFS;
        }
        if (firstBusinessData.YY1_FD_FHYQ) {
            headerData.YY1_FD_FHYQ_SDH = firstBusinessData.YY1_FD_FHYQ;
        }
        if (firstBusinessData.YY1_FD_FKG) {
            headerData.YY1_FD_FKG_SDH = firstBusinessData.YY1_FD_FKG;
        }
        if (firstBusinessData.YY1_FD_JSFS) {
            headerData.YY1_FD_JSFS_SDH = firstBusinessData.YY1_FD_JSFS;
        }
        if (firstBusinessData.YY1_FD_PT) {
            headerData.YY1_FD_PT_SDH = firstBusinessData.YY1_FD_PT;
        }
        if (firstBusinessData.YY1_FD_SFBG) {
            headerData.YY1_FD_SFBG_SDH = firstBusinessData.YY1_FD_SFBG;
        }
        if (firstBusinessData.YY1_FD_SFHD) {
            headerData.YY1_FD_SFHD_SDH = firstBusinessData.YY1_FD_SFHD;
        }
        if (firstBusinessData.YY1_FD_TMBQ) {
            headerData.YY1_FD_TMBQ_SDH = firstBusinessData.YY1_FD_TMBQ;
        }
        if (firstBusinessData.YY1_FD_YDG) {
            headerData.YY1_FD_YDG_SDH = firstBusinessData.YY1_FD_YDG;
        }
        if (firstBusinessData.YY1_FD_YSFS) {
            headerData.YY1_FD_YSFS_SDH = firstBusinessData.YY1_FD_YSFS;
        }
        if (firstBusinessData.YY1_FD_ZTMWZ) {
            headerData.YY1_FD_ZTMWZ_SDH = firstBusinessData.YY1_FD_ZTMWZ;
        }
        if (firstBusinessData.YY1_FD_ZH) {
            headerData.YY1_FD_ZH_SDH = firstBusinessData.YY1_FD_ZH;
        }
        if (firstBusinessData.YY1_FD_ZDFJY) {
            headerData.YY1_FD_ZDFJY_SDH = firstBusinessData.YY1_FD_ZDFJY;
        }

        return headerData;
    }

    /**
     * 根据业务类型动态选择销售订单号
     * @param {string} zrfcid - 业务流程ID
     * @param {string} canum - 步骤号
     * @param {Array} piSalesOrderRelRecords - PISalesOrderRel 记录列表
     * @returns {string|null} 销售订单号
     */
    getSalesOrderByType(zrfcid, canum, piSalesOrderRelRecords) {
        const step = parseInt(canum);
        
        // SD03 步骤 10：对外销售订单，使用 SalesOrder
        if (zrfcid === 'SD03' && step === 10) {
            const record = piSalesOrderRelRecords[0];
            if (record && record.SalesOrder) {
                return record.SalesOrder;
            }
        }
        // SD01/SD03 步骤 40/50：公司间销售订单，使用 SalesOrder1（SalesOrder2 留作未来其他场景使用）
        else if ((zrfcid === 'SD01' || zrfcid === 'SD03') && (step === 40 || step === 50)) {
            const record = piSalesOrderRelRecords[0];
            if (record && record.SalesOrder1) {
                return record.SalesOrder1;
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
                        .columns(['PIOrder', 'PIOrderItem', 
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
     * 检查是否需要跳过此步骤
     * @param {string} zrfcid - 业务流程ID
     * @param {string} canum - 步骤号
     * @param {Array} piSalesOrderRelRecords - PISalesOrderRel 记录列表
     * @returns {Promise<Object|null>} 如果需要跳过返回跳过结果，否则返回null
     */
    async checkSkipCondition(zrfcid, canum, piSalesOrderRelRecords) {
        const step = parseInt(canum);
        
        // SD01 或 SD03 且步骤为 40：检查 SalesOrder1 是否有值
        if ((zrfcid === 'SD01' || zrfcid === 'SD03') && step === 40) {
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

module.exports = SalesOrderHeaderUpdateService;