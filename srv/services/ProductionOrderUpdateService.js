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

            // 获取 CSRF token（使用 OData V2 格式）
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
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
            
            for (let index = 0; index < businessDataList.length; index++) {
                const businessData = businessDataList[index];
                
                // 构建生产工单创建数据（单行）
                const productionOrderData = await this.buildProductionOrderData(businessData, mptStepConfig, zrfcid);
                
                console.log(`开始创建生产工单 ${index + 1}/${businessDataList.length}`);
                console.log('生产工单数据:', JSON.stringify(productionOrderData, null, 2));

                // 调用生产工单创建 API（OData V2 格式）
                const result = await executeHttpRequest(
                    {
                        destinationName: 'ES_API'
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
     * @returns {Object} 生产工单创建数据
     */
    async buildProductionOrderData(businessData, mptStepConfig, zrfcid) {
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
            MfgOrderPlannedStartDate: this.formatDateForSAP(businessData.ProductionStartDate),
            // 计划结束日期（格式：/Date(timestamp)/）
            MfgOrderPlannedEndDate: this.formatDateForSAP(businessData.ConfirmedDeliveryDate),
            //箱唛要求
            YY1_FD_PP_XMYQ_ORD: businessData.YY1_FD_XMYQ,
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
            //备注（去除换行符和特殊字符，SAP API不接受）
            YY1_FD_REMARK_ORD: this.cleanRemark(businessData.Remark),
        };

        // 根据 zrfcid 添加不同的字段
        if (zrfcid === 'SD01') {
            // SD01 业务流程：从 PISalesOrderRel 表获取内部交易1相关字段
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = businessData.PIOrderItem || '';
            
            if (piOrder && piOrderItem) {
                const relRecord = await cds.run(
                    SELECT.one.from(PISalesOrderRel)
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                if (relRecord) {
                    productionOrderData.YY1_FD_SO3_ORD = relRecord.PurchaseOrder1;
                    productionOrderData.YY1_FD_SOITEM3_ORD = relRecord.PurchaseOrderItem1;
                }
            }
        } else if (zrfcid === 'SD05') {
            // SD05 业务流程：从 PISalesOrderRel 表获取销售订单相关字段
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = businessData.PIOrderItem || '';
            
            if (piOrder && piOrderItem) {
                const relRecord = await cds.run(
                    SELECT.one.from(PISalesOrderRel)
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                if (relRecord) {
                    productionOrderData.YY1_FD_SO2_ORD = relRecord.SalesOrder;
                    productionOrderData.YY1_FD_SOITEM2_ORD = relRecord.SalesOrderItem;
                }
            }
        } else if (zrfcid === 'SD06') {
            // SD06 业务流程：从 PISalesOrderRel 表获取销售订单和采购订单相关字段
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const piOrder = businessData.PIOrder || '';
            const piOrderItem = businessData.PIOrderItem || '';
            
            if (piOrder && piOrderItem) {
                const relRecord = await cds.run(
                    SELECT.one.from(PISalesOrderRel)
                        .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                );
                
                if (relRecord) {
                    productionOrderData.YY1_FD_SO2_ORD = relRecord.SalesOrder;
                    productionOrderData.YY1_FD_SOITEM2_ORD = relRecord.SalesOrderItem;
                    productionOrderData.YY1_FD_SO3_ORD = relRecord.PurchaseOrder1;
                    productionOrderData.YY1_FD_SOITEM3_ORD = relRecord.PurchaseOrderItem1;
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
}

module.exports = ProductionOrderCreateService;
