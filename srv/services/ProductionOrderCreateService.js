const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const CommonUtils = require('../handlers/CommonUtils');

class ProductionOrderCreateService {
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

            // 使用通用工具类读取之前步骤的 objkey（销售订单号或采购订单号）
            let sourceDocument = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                sourceDocument = previousObjkey;
            }

            // 读取 ProcessConfig 表获取业务表名（使用业务表1）
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid, true);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 读取业务表数据
            const businessDataResult = await this.getBusinessData(businessTable, zrfcLogid);
            if (businessDataResult.code === 'E') {
                return {
                    code: 'E',
                    message: businessDataResult.message,
                    objkey: ''
                };
            }
            const businessDataList = businessDataResult.businessData;
            console.log('[ProductionOrderCreateService] 业务数据条数:', businessDataList.length);

            // 获取 CSRF token（使用 OData V2 格式）
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/',
                    headers: {
                        'X-CSRF-Token': 'Fetch'
                    }
                }
            );

            // 提取 cookie 和 CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];

            // 为每一行业务数据创建一张独立的生产工单
            const createResults = [];
            const createdOrderNumbers = [];
            
            // 循环前一次性查询所有已存在的生产工单
            const existingOrdersMap = await this.getExistingProductionOrders(businessDataList);
            
            // 循环前批量查询所有 PISalesOrderRel 数据
            const piSalesOrderRelMap = await this.getPISalesOrderRelMap(businessDataList);
            
            for (let index = 0; index < businessDataList.length; index++) {
                const businessData = businessDataList[index];
                
                // 从 Map 中获取已存在的生产工单
                const key = `${businessData.PIOrder}-${businessData.PIOrderItem}`;
                const existingOrder = existingOrdersMap.get(key);
                if (existingOrder) {
                    console.log(`跳过已存在生产工单的数据: PIOrder=${businessData.PIOrder}, PIOrderItem=${businessData.PIOrderItem}, ProductionOrder=${existingOrder}`);
                    continue;
                }
                
                // 构建生产工单创建数据（单行）
                const productionOrderData = await this.buildProductionOrderData(businessData, mptStepConfig, zrfcid, piSalesOrderRelMap);
                
                console.log(`开始创建生产工单 ${index + 1}/${businessDataList.length}`);
                console.log('生产工单数据:', JSON.stringify(productionOrderData, null, 2));

                // 调用生产工单创建 API（OData V2 格式）
                const result = await executeHttpRequest(
                    {
                        destinationName: this.commonUtils.getDestinationName()
                    },
                    {
                        method: 'POST',
                        url: '/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2',
                        data: productionOrderData,
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

                console.log('创建生产工单位状态码:', result.status);

                if (result.status >= 200 && result.status < 300) {
                    const responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
                    const productionOrder = responseData?.d?.ManufacturingOrder || '';
                    
                    console.log('生产工单创建成功:', productionOrder);
                    
                    // 将生产工单号更新到 PISalesOrderRel 表
                    await this.updatePISalesOrderRel(productionOrder, businessData);
                    
                    createResults.push({
                        success: true,
                        productionOrder: productionOrder,
                        index: index
                    });
                    createdOrderNumbers.push(productionOrder);
                } else {
                    const errorMessage = this.parseError(result.data);
                    console.error(`生产工单 ${index + 1} 创建失败:`, errorMessage);
                    createResults.push({
                        success: false,
                        errorMessage: errorMessage,
                        index: index
                    });
                }
            }

            // 检查所有工单创建结果
            const allSuccess = createResults.every(r => r.success);
            const failedCount = createResults.filter(r => !r.success).length;
            
            if (allSuccess) {
                return {
                    code: 'S',
                    message: '生产工单创建成功',
                    objkey: createdOrderNumbers[createdOrderNumbers.length - 1] || ''  // 返回最后一张工单号
                };
            } else {
                // 只返回失败的消息文本
                const failedResults = createResults.filter(r => !r.success);
                const errorMessage = failedResults.map(r => r.errorMessage).join('; ');
                console.error('生产工单创建失败:', errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: createdOrderNumbers[createdOrderNumbers.length - 1] || ''  // 返回最后成功创建的工单号
                };
            }

        } catch (error) {
            console.error('ProductionOrderCreateService 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '生产工单创建失败',
                objkey: ''
            };
        }
    }

    /**
     * 构建生产工单创建数据
     * @param {Object} businessData - 单行业务数据
     * @param {Object} mptStepConfig - MPTStepConfig 配置
     * @param {string} zrfcid - 业务流程ID
     * @param {Map} piSalesOrderRelMap - PISalesOrderRel 数据映射
     * @returns {Object} 生产工单创建数据
     */
    async buildProductionOrderData(businessData, mptStepConfig, zrfcid, piSalesOrderRelMap) {
        // 构建基本数据（单行）
        const productionOrderData = {
            // 生产订单类型
            ManufacturingOrderType: 'ZS01',
            // 工厂（从 MPTStepConfig 获取 werks）
            ProductionPlant: mptStepConfig?.werks,
            // 物料
            Material: businessData.Material,
            // 数量
            TotalQuantity: businessData.RequestedQuantity,
            // 计划开始日期（格式：/Date(timestamp)/）
            MfgOrderPlannedStartDate: this.formatDateForSAP(businessData.ConfirmedDeliveryDate),
            // 计划结束日期（格式：/Date(timestamp)/）
            MfgOrderPlannedEndDate: this.formatDateForSAP(businessData.ConfirmedDeliveryDate),
            //销售部门
            YY1_FD_ZSalesGroupName_ORD: businessData.SalesOffice || '',
            //客户编号
            YY1_FD_ZSoldToParty_ORD: businessData.Customer || businessData.SalesDistrict || '',
            //打包要求
            YY1_FD_PP_FHYQ_ORD: businessData.YY1_FD_FHYQ,
            //条码标签
            YY1_FD_PP_TMBQ_ORD: businessData.YY1_FD_TMBQ,
            //粘贴美文纸
            YY1_FD_PP_ZTMWZ_ORD: businessData.YY1_FD_ZTMWZ,
            //定制卡板
            YY1_FD_PP_DZKB_ORD: businessData.YY1_FD_DZKB,
            //要求的交货日期（格式：/Date(timestamp)/）
            YY1_FD_REQDATE_ORD: this.formatDateForSAP(businessData.RequestedDeliveryDate),
            //箱唛要求
            YY1_FD_PP_XMYQ_ORD: businessData.YY1_FD_XMYQ,
            //箱唛资料
            YY1_FD_XMZL_ORD: businessData.YY1_FD_XMZL,
            //备注（去除换行符和特殊字符，SAP API不接受）
            YY1_FD_REMARK_ORD: this.cleanRemark(businessData.Remark),
        };

        // 从 Map 中获取 PISalesOrderRel 数据
        const piOrder = businessData.PIOrder || '';
        const piOrderItem = businessData.PIOrderItem || '';

        if (piOrder && piOrderItem && piSalesOrderRelMap) {
            const key = `${piOrder}-${piOrderItem}`;
            const relRecord = piSalesOrderRelMap.get(key);

            if (relRecord) {
                switch (zrfcid) {
                    case 'SD01':
                        productionOrderData.YY1_FD_SO3_ORD = relRecord.PurchaseOrder1;
                        productionOrderData.YY1_FD_SOITEM3_ORD = relRecord.PurchaseOrderItem1;
                        break;
                    case 'SD06':
                        productionOrderData.YY1_FD_SO2_ORD = relRecord.SalesOrder;
                        productionOrderData.YY1_FD_SOITEM2_ORD = relRecord.SalesOrderItem;
                        productionOrderData.YY1_FD_SO3_ORD = relRecord.PurchaseOrder1;
                        productionOrderData.YY1_FD_SOITEM3_ORD = relRecord.PurchaseOrderItem1;
                        break;
                    case 'SD08':
                        productionOrderData.YY1_FD_SO3_ORD = relRecord.PurchaseOrder1;
                        productionOrderData.YY1_FD_SOITEM3_ORD = relRecord.PurchaseOrderItem1;
                        productionOrderData.YY1_FD_SO4_ORD = relRecord.PurchaseOrder2;
                        productionOrderData.YY1_FD_SOITEM4_ORD = relRecord.PurchaseOrderItem2;
                        break;
                }
            }
        }

        return productionOrderData;
    }

    /**
     * 将生产工单号更新到 PISalesOrderRel 表
     * @param {string} productionOrder - 生产工单号
     * @param {Object} businessData - 业务数据
     */
    async updatePISalesOrderRel(productionOrder, businessData) {
        try {
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const { INSERT, UPDATE } = cds.ql;
            
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = businessData.PIOrderItem || '';
            
            console.log(`[updatePISalesOrderRel] 开始更新 PISalesOrderRel, piOrder=${piOrder}, piOrderItem=${piOrderItem}, productionOrder=${productionOrder}`);
            
            if (piOrder && piOrderItem && productionOrder) {
                // 先尝试更新（参考 PurchaseOrderService 的逻辑）
                const updateResult = await cds.run(
                    UPDATE(PISalesOrderRel)
                        .set({ ProductionOrder: productionOrder })
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                console.log(`[updatePISalesOrderRel] 更新结果:`, updateResult);
                
                // 如果没有更新到数据（表中没有该记录），则插入新记录
                if (updateResult?.affectedRows === 0 || !updateResult) {
                    console.log(`[updatePISalesOrderRel] 更新未影响任何行，尝试插入新记录`);
                    await cds.run(
                        INSERT.into(PISalesOrderRel).entries({
                            zrfc_logid: this.zrfcLogid,
                            PIOrder: piOrder,
                            PIOrderItem: piOrderItem,
                            ProductionOrder: productionOrder
                        })
                    );
                    console.log(`PISalesOrderRel 插入成功: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}, ProductionOrder=${productionOrder}`);
                } else {
                    console.log(`PISalesOrderRel 更新成功: PIOrder=${piOrder}, PIOrderItem=${piOrderItem}, ProductionOrder=${productionOrder}`);
                }
            }
        } catch (error) {
            console.error(`PISalesOrderRel 更新/插入失败:`, error);
        }
    }

    /**
     * 批量查询所有已存在的生产工单
     * @param {Array} businessDataList - 业务数据列表
     * @returns {Map} 生产工单映射，key 为 "PIOrder-PIOrderItem"，value 为 ProductionOrder
     */
    async getExistingProductionOrders(businessDataList) {
        try {
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const { SELECT } = cds.ql;
            
            // 获取第一个非空的 PIOrder（所有数据的 PIOrder 相同）
            const firstItem = businessDataList.find(item => item.PIOrder);
            if (!firstItem?.PIOrder) {
                return new Map();
            }
            
            const piOrder = firstItem.PIOrder;
            
            // 使用单个 PIOrder 条件查询
            const results = await cds.run(
                SELECT.from(PISalesOrderRel)
                    .columns(['PIOrder', 'PIOrderItem', 'ProductionOrder'])
                    .where({ PIOrder: piOrder })
            );
            
            // 转换为 Map，key 为 "PIOrder-PIOrderItem"
            const map = new Map();
            for (const result of results) {
                const key = `${result.PIOrder}-${result.PIOrderItem}`;
                if (result.ProductionOrder) {
                    map.set(key, result.ProductionOrder);
                }
            }
            
            return map;
        } catch (error) {
            console.error(`批量查询 PISalesOrderRel 失败:`, error);
            return new Map();
        }
    }

    /**
     * 批量查询所有 PISalesOrderRel 完整数据
     * @param {Array} businessDataList - 业务数据列表
     * @returns {Map} PISalesOrderRel 数据映射，key 为 "PIOrder-PIOrderItem"
     */
    async getPISalesOrderRelMap(businessDataList) {
        try {
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const { SELECT } = cds.ql;
            
            // 提取所有不重复的 PIOrder
            const piOrders = [...new Set(businessDataList
                .filter(item => item.PIOrder)
                .map(item => item.PIOrder))];
            
            if (piOrders.length === 0) {
                return new Map();
            }
            
            // 使用 IN 条件查询多个 PIOrder 的数据
            const results = await cds.run(
                SELECT.from(PISalesOrderRel)
                    .where({ PIOrder: { in: piOrders } })
            );
            
            // 转换为 Map，key 为 "PIOrder-PIOrderItem"
            const map = new Map();
            for (const result of results) {
                const key = `${result.PIOrder}-${result.PIOrderItem}`;
                map.set(key, result);
            }
            
            return map;
        } catch (error) {
            console.error(`批量查询 PISalesOrderRel 完整数据失败:`, error);
            return new Map();
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
     * 清理备注字段，去除换行符和特殊字符（SAP API不接受这些字符）
     * @param {string} remark - 原始备注内容
     * @returns {string} 清理后的备注内容
     */
    cleanRemark(remark) {
        if (!remark) return '';
        
        // 第一步：去除换行符、制表符和多余空格
        let cleaned = remark
            .replace(/\r\n/g, ' ')    // 替换 Windows 换行符
            .replace(/\n/g, ' ')      // 替换 Unix 换行符
            .replace(/\r/g, ' ')      // 替换 Mac 换行符
            .replace(/\t/g, ' ')      // 替换制表符
            .replace(/\s+/g, ' ')     // 合并多个空格为一个
            .trim();                  // 去除首尾空格
        
        // 第二步：移除SAP不支持的特殊字符（使用正则表达式一次性匹配）
        // 包含：特殊符号、数学符号、中文标点、特殊Unicode字符等
        const specialChars = /[\*\/\\@#\$%&<>=\|\^~`'"()（）【】「」『』《》：；！？、。·×÷＋－＝＜＞≠≤≥∞∑∏√π°℃℉㎡㎏㎝㎜μΩ℧∪∩∈∉⊂⊃⊆⊇⊄⊅∅∀∃∴∵∶∷]/g;
        cleaned = cleaned.replace(specialChars, '');
        
        // 第三步：再次合并空格并去除首尾空格
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        
        // 第四步：限制长度（ES字段长度为255）
        const maxLength = 255;
        if (cleaned.length > maxLength) {
            cleaned = cleaned.substring(0, maxLength);
        }
        
        return cleaned;
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

    /**
     * 读取业务表数据
     */
    async getBusinessData(businessTable, zrfcLogid) {
        try {
            const entity = cds.entities[`com.sap.zictm.${businessTable}`];
            if (!entity) {
                return { code: 'E', message: `业务表 ${businessTable} 不存在` };
            }

            const businessData = await cds.run(
                SELECT.from(entity)
                        .where({ zrfc_logid: zrfcLogid })
            );

            if (!businessData || businessData.length === 0) {
                return { code: 'E', message: `未找到业务数据，zrfcLogid: ${zrfcLogid}` };
            }

            return { code: 'S', businessData: businessData };
        } catch (error) {
            console.error('[ProductionOrderCreateService.getBusinessData] 获取业务数据失败:', error);
            return { code: 'E', message: `获取业务数据失败: ${error.message}` };
        }
    }
}

module.exports = ProductionOrderCreateService;
