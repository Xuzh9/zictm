const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
const CommonUtils = require('../handlers/CommonUtils');

class SalesOrderCreateService {
    constructor() {
        this.zrfcLogid = null;
        this.commonUtils = new CommonUtils();
    }

    async initService(zrfcLogid, zrfcid, canum) {
        this.zrfcLogid = zrfcLogid;
        this.zrfcid = zrfcid;
        this.canum = canum;
    }

    /**
     * 根据销售订单类型获取 API 配置
     * @param {string} salesOrderType - 销售订单类型
     * @returns {Object} API 配置对象
     */
    getApiConfig(salesOrderType) {
        switch (salesOrderType) {
            case 'CR':
            case 'DR':
                // 借贷项订单（CR/DR）
                return {
                    csrfUrl: '/sap/opu/odata/sap/API_DEBIT_MEMO_REQUEST_SRV/$metadata',
                    createUrl: '/sap/opu/odata/sap/API_DEBIT_MEMO_REQUEST_SRV/A_DebitMemoRequest',
                    responseField: 'CreditMemoRequest',
                    dateField: 'CreditMemoRequestDate',
                    itemCategoryField: 'CreditMemoRequestItemCategory',
                    itemCategory: salesOrderType === 'CR' ? 'G2N' : 'L2N',
                    plantField: 'Plant',
                    orderTypeField: 'CreditMemoRequestType',
                    itemField: 'CreditMemoRequestItem'
                };
            case 'CBRE':
                // CBRE 退货订单
                return {
                    csrfUrl: '/sap/opu/odata/sap/API_CUSTOMER_RETURN_SRV/$metadata',
                    createUrl: '/sap/opu/odata/sap/API_CUSTOMER_RETURN_SRV/A_CustomerReturn',
                    responseField: 'CustomerReturn',
                    dateField: 'CustomerReturnDate',
                    itemCategoryField: 'CustomerReturnItemCategory',
                    itemCategory: 'CBEN',
                    plantField: 'ProductionPlant',
                    orderTypeField: 'CustomerReturnType',
                    itemField: 'CustomerReturnItem'
                };
            case 'ZPR':
            case 'OR':
                // OR/ZPR 标准销售订单
                return {
                    csrfUrl: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/$metadata',
                    createUrl: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder',
                    responseField: 'SalesOrder',
                    dateField: 'SalesOrderDate',
                    itemCategoryField: 'SalesOrderItemCategory',
                    itemCategory: 'TAN',
                    plantField: 'ProductionPlant',
                    orderTypeField: 'SalesOrderType',
                    itemField: 'SalesOrderItem'
                };
        }
    }

    async execute(inputData) {
        try {
            const { zrfcid, canum, serviceName, readsteps, objkey, zrfcLogid, zdfjy } = inputData;
            
            this.zrfcLogid = zrfcLogid;

            console.log('[SalesOrderCreateService] 开始执行, zrfcid:', zrfcid, 'canum:', canum, 'zdfjy:', zdfjy);

            // 读取 ProcessConfig 表获取业务表名
            const businessTable = await this.getBusinessTable(zrfcid);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }
            console.log('[SalesOrderCreateService] 业务表名:', businessTable);

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
            console.log('[SalesOrderCreateService] 业务数据条数:', businessDataList.length);

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            console.log('[SalesOrderCreateService] 查询 MPTStepConfig, zdfjy:', zdfjy, ', canum:', canum);
            const mptStepConfig = await this.getMPTStepConfig(businessDataList, canum, zdfjy);
            console.log('[SalesOrderCreateService] MPTStepConfig 查询结果:', JSON.stringify(mptStepConfig));

            // 获取销售订单类型（从第一条业务数据获取）
            const salesOrderType = businessDataList[0]?.SalesOrderType;
            
            // 根据销售订单类型获取 API 配置
            const apiConfig = this.getApiConfig(salesOrderType);
            console.log('[SalesOrderCreateService] 销售订单类型:', salesOrderType, ', API配置:', apiConfig);

            // 构建销售订单数据
            const salesOrderData = this.buildSalesOrderData(businessDataList, mptStepConfig, apiConfig, zrfcid);
            
            // 调试：打印请求数据
            console.log('[SalesOrderCreateService] 请求数据:', JSON.stringify(salesOrderData, null, 2));
 
            // 获取 CSRF token
            console.log('[SalesOrderCreateService] 开始获取 CSRF token...');
            const csrfResult = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'GET',
                    url: apiConfig.csrfUrl,
                    headers: {
                        'X-CSRF-Token': 'Fetch'
                    }
                }
            );
            console.log('[SalesOrderCreateService] CSRF token 获取成功, status:', csrfResult.status);

            // 提取 cookie 和 CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];
            
            // 调用销售订单创建 API
            console.log('[SalesOrderCreateService] 开始调用销售订单 API...');
            const result = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'POST',
                    url: apiConfig.createUrl,
                    data: salesOrderData,
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

            if (result.status >= 200 && result.status < 300) {
                const salesOrder = result.data.d?.[apiConfig.responseField] || '';
                
                // SD05/SD06 需要更新 PISalesOrderRel 表
                if (zrfcid === 'SD05' || zrfcid === 'SD06') {
                    await this.updatePISalesOrderRel(salesOrder, businessDataList);
                }
                
                const returnResult = {
                    code: 'S',
                    message: '销售订单创建成功',
                    objkey: salesOrder
                };
                return returnResult;
            } else {
                let errorMessage = `API 调用失败: ${result.status}`;
                if (result.data && result.data.error) {
                    const error = result.data.error;
                    if (error.message && error.message.value) {
                        errorMessage = error.message.value;
                    } else if (error.message) {
                        errorMessage = error.message;
                    }
                }
                console.error('[SalesOrderCreateService] API 调用失败:', errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('[SalesOrderCreateService] 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '销售订单创建失败',
                objkey: ''
            };
        }
    }

    /**
     * 获取业务表名
     */
    async getBusinessTable(zrfcid) {
        try {
            const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
            const config = await cds.run(
                SELECT.one.from(ProcessConfig)
                    .where({ zrfcid: zrfcid })
            );
            if (config && config.businessTable1) {
                return config.businessTable1;
            }
            return null;
        } catch (error) {
            console.error('[SalesOrderCreateService.getBusinessTable] 获取业务表名失败:', error);
            return null;
        }
    }

    /**
     * 获取业务数据
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
            console.error('[SalesOrderCreateService.getBusinessData] 获取业务数据失败:', error);
            return { code: 'E', message: `获取业务数据失败: ${error.message}` };
        }
    }

    /**
     * 获取步骤配置
     * 通过业务表的 SalesOrganization(zxsf) 和 ReceivingPlant(zfcf) 查找
     */
    async getMPTStepConfig(businessDataList, canum, zdfjy) {
        if (!businessDataList || businessDataList.length === 0 || !canum) {
            return null;
        }
        
        try {
            let configZdfjy = zdfjy;
            
            if (!configZdfjy) {
                const mainData = businessDataList[0];
                const salesOrganization = mainData.SalesOrganization;
                const receivingPlant = mainData.ReceivingPlant;
                
                console.log('[SalesOrderCreateService.getMPTStepConfig] SalesOrganization:', salesOrganization, 'ReceivingPlant:', receivingPlant);
                
                const MPTTypeConfig = cds.entities['com.sap.zictm.MPTTypeConfig'];
                const mptTypeConfig = await cds.run(
                    SELECT.one.from(MPTTypeConfig)
                        .where({ zxsf: salesOrganization, zfcf: receivingPlant })
                );
                
                if (!mptTypeConfig) {
                    console.log('[SalesOrderCreateService.getMPTStepConfig] 未找到 MPTTypeConfig 配置');
                    return null;
                }
                
                configZdfjy = mptTypeConfig.zdfjy;
                console.log('[SalesOrderCreateService.getMPTStepConfig] 找到 zdfjy:', configZdfjy);
            }
            
            const config = await this.commonUtils.getMPTStepConfig(configZdfjy, canum);
            return config;
        } catch (error) {
            console.error('获取 MPTStepConfig 失败:', error);
            return null;
        }
    }

    /**
     * 构建销售订单数据
     */
    buildSalesOrderData(businessDataList, mptStepConfig, apiConfig, zrfcid) {
        if (!businessDataList || businessDataList.length === 0) {
            return {};
        }

        const mainData = businessDataList[0];
        const salesOrderType = mainData.SalesOrderType;
        
        // 根据 zrfcid 获取工厂字段值
        let plantValue;
        switch (zrfcid) {
            case 'SD02':
                plantValue = mainData.ReceivingPlant;
                break;
            case 'SD04':
                plantValue = mptStepConfig?.werks;
                break;
            case 'SD01':
            case 'SD05':
            case 'SD06':
                plantValue = mainData.ProductionPlant;
                break;
        }
        
        // 业务表按 PIOrder 和 PIOrderItem 正序排序
        businessDataList.sort((a, b) => {
            const orderCompare = (a.PIOrder || '').localeCompare(b.PIOrder || '');
            return orderCompare !== 0 ? orderCompare : (a.PIOrderItem || '').localeCompare(b.PIOrderItem || '');
        });
        
        // 构建行项目
        const salesOrderItems = businessDataList.map((item, index) => {
            // 使用业务表的行项目号字段
            const itemNumber = (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? item.PIOrderItem : item.SalesOrderItem;
            
            // 根据销售订单类型使用动态字段名
            const itemCategoryField = apiConfig.itemCategoryField;
            const itemCategory = apiConfig.itemCategory;
            const plantField = apiConfig.plantField;
            
            // 构建定价元素
            const pricingElements = [];
            
            if (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') {
                // SD01/SD05/SD06: 根据 VALUE 字段动态构建定价元素
                const conditionTypes = ['ZB01', 'ZB02', 'ZB03', 'ZB04', 'ZC01', 'ZC02', 'ZP00'];
                
                console.log(`[SalesOrderCreateService] 构建定价元素 - zrfcid: ${zrfcid}, item.ZP00_Value: ${item.ZP00_Value}`);
                
                for (const conditionType of conditionTypes) {
                    const valueField = `${conditionType}_Value`;
                    if (item[valueField]) {
                        console.log(`[SalesOrderCreateService] 添加定价元素: ${conditionType}, 值: ${item[valueField]}`);
                        pricingElements.push({
                            ConditionType: conditionType,
                            ConditionRateValue: String(item[valueField]),
                            ConditionQuantity: String(item[`${conditionType}_UnitOfMeasure`]) || "1",
                            ConditionCurrency: item[`${conditionType}_CurrencyCode`] || item.ItemTransactionCurrency
                        });
                    }
                }
            } else {
                // 其他流程：使用默认的 ZP10 定价元素
                pricingElements.push({
                    ConditionType: "ZP10",
                    ConditionRateValue: String(item.NetAmount) || "0",
                    ConditionQuantity: "1",
                    ConditionCurrency: item.ItemTransactionCurrency
                });
            }
            
            // 如果行项目类别是 CBXN，增加 ZKNP 定价条件
            if (item.SalesOrderItemCategory === 'CBXN') {
                pricingElements.push({
                    ConditionType: "ZKNP",
                    ConditionRateValue: "0",
                    ConditionQuantity: "1",
                    ConditionCurrency: item.ItemTransactionCurrency
                });
            }
            
            const itemData = {
                [apiConfig.itemField]: itemNumber,
                Material: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (item.Material || "") : (item.Product || ""),
                RequestedQuantity: item.RequestedQuantity ? parseFloat(item.RequestedQuantity).toString() : "0",
                YY1_FD_FNSKU_SDI: item.YY1_FD_FNSKU || "",
                YY1_FD_SKU_SDI: item.YY1_FD_SKU || "",
                YY1_FD_DZKB_SDI: item.YY1_FD_DZKB || "",
                to_PricingElement: {
                    results: pricingElements
                }
            };
            
            if (item.SalesOrderItemCategory === 'CBXN') {
                itemData.MatlAccountAssignmentGroup = "03";
            }
            
            // 设置工厂字段（使用动态字段名）
            if (plantValue) {
                itemData[plantField] = plantValue;
            }
            
            // 设置行项目类别（使用动态字段名）
            itemData[itemCategoryField] = item.SalesOrderItemCategory || itemCategory;
            
            // 当 ItemRemark 有值时，添加行项目的 to_Text 结构
            if (item.ItemRemark) {
                itemData.to_Text = {
                    results: [{
                        Language: "ZH",
                        LongTextID: "0001",
                        LongText: item.ItemRemark
                    }]
                };
            }
            
            return itemData;
        });

        // 构建销售订单主数据
        let salesOrderData = {
            SalesOrganization: mainData.SalesOrganization || mptStepConfig?.vkorg,
            SalesOffice: mainData.SalesOffice || "",
            SalesGroup: mainData.SalesGroup || "",
            DistributionChannel: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (mainData.DistributionChannel) : (mptStepConfig?.vtweg),
            OrganizationDivision: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (mainData.OrganizationDivision || "00") : (mptStepConfig?.spart || "00"),
            SoldToParty: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (mainData.SalesDistrict || mptStepConfig?.kunnr) : (mainData.Customer || mptStepConfig?.kunnr),
            PurchaseOrderByCustomer: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (mainData.PIOrder || "") : (mainData.SalesOrder || ""),
            TransactionCurrency: mainData.TransactionCurrency,
            YY1_FD_ZDFJY_SDH: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? mainData.YY1_FD_ZDFJY : mptStepConfig?.zdfjy,
            YY1_FD_ZRFCID2_SDH: zrfcid,
            YY1_FD_XMYQ_SDH: mainData.YY1_FD_XMYQ || "",              
            YY1_FD_DBFS_SDH: mainData.YY1_FD_DBFS || "",                
            YY1_FD_FHYQ_SDH: mainData.YY1_FD_FHYQ || "",
            YY1_FD_FKG_SDH: mainData.YY1_FD_FKG || "",
            YY1_FD_JSFS_SDH: mainData.YY1_FD_JSFS || "",
            YY1_FD_PT_SDH: mainData.YY1_FD_PT || "",
            YY1_FD_SFBG_SDH: mainData.YY1_FD_SFBG || "",
            YY1_FD_SFHD_SDH: mainData.YY1_FD_SFHD || "",                
            YY1_FD_TMBQ_SDH: mainData.YY1_FD_TMBQ || "",                 
            YY1_FD_YDG_SDH: mainData.YY1_FD_YDG || "",                
            YY1_FD_YSFS_SDH: mainData.YY1_FD_YSFS || "",                  
            YY1_FD_ZTMWZ_SDH: mainData.YY1_FD_ZTMWZ || "",              
            YY1_FD_ZH_SDH: mainData.YY1_FD_ZH || "",      
            YY1_FD_SPLLHH_SDH: mainData.YY1_FD_SPLLHH || "",               
            to_Item: {
                results: salesOrderItems
            }
        };
        
        // 当 Remark 有值时，添加抬头的 to_Text 结构
        if (mainData.Remark) {
            salesOrderData.to_Text = {
                results: [{
                    Language: "ZH",
                    LongTextID: "TX01",
                    LongText: mainData.Remark
                }]
            };
        }
        
        // 根据订单类型设置对应的订单类型字段（从 apiConfig 获取字段名）
        salesOrderData[apiConfig.orderTypeField] = salesOrderType || '';
        
        // 根据业务流程设置销售订单日期
        if (apiConfig.dateField) {
            if (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') {
                salesOrderData[apiConfig.dateField] = this.convertDate(new Date());
            } else if (mainData.SalesOrderDate) {
                salesOrderData[apiConfig.dateField] = this.convertDate(mainData.SalesOrderDate);
            }
        }

        // 根据业务流程设置交货日期字段
        if (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') {
            if (mainData.ConfirmedDeliveryDate) {
                salesOrderData.RequestedDeliveryDate = this.convertDate(mainData.ConfirmedDeliveryDate);
            }
        } else if (mainData.DeliveryDate) {
            salesOrderData.RequestedDeliveryDate = this.convertDate(mainData.DeliveryDate);
        }

        return salesOrderData;
    }

    /**
     * 转换日期格式
     * 将 /Date(1492041600000)/ 格式转换为 ISO 日期格式
     * @param {string} dateStr - 日期字符串
     * @returns {string} ISO 日期格式字符串
     */
    convertDate(dateStr) {
        if (!dateStr) {
            return null;
        }

        // 处理 ISO 日期格式 2026-05-13 或 2026-05-13T00:00:00 转换为 /Date(timestamp)/ 格式
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            return `/Date(${date.getTime()})/`;
        }
        
        // 如果无法识别，直接返回原值
        return dateStr;
    }

    /**
     * 更新或插入 PISalesOrderRel 表
     */
    async updatePISalesOrderRel(salesOrder, businessDataList) {
        try {
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            
            for (const item of businessDataList) {
                const piOrder = item.PIOrder || '';
                const piOrderItem = item.PIOrderItem || '';
                
                if (piOrder && piOrderItem && salesOrder) {
                    // 先尝试更新
                    const updateResult = await cds.run(
                        UPDATE(PISalesOrderRel)
                            .set({ SalesOrder: salesOrder, SalesOrderItem: String(piOrderItem).padStart(6, '0') })
                            .where({ PIOrder: piOrder, PIOrderItem: piOrderItem })
                    );
                    
                    console.log('[SalesOrderCreateService.updatePISalesOrderRel] 更新结果:', updateResult);
                    
                    // 如果更新影响行数为0，则执行插入
                    if (!updateResult || (typeof updateResult === 'number' && updateResult === 0)) {
                        console.log('[SalesOrderCreateService.updatePISalesOrderRel] 未找到记录，执行插入');
                        const insertResult = await cds.run(
                            INSERT.into(PISalesOrderRel)
                                .entries({
                                    PIOrder: piOrder,
                                    PIOrderItem: piOrderItem,
                                    zrfc_logid: this.zrfcLogid,
                                    SalesOrder: salesOrder,
                                    SalesOrderItem: String(piOrderItem).padStart(6, '0')
                                })
                        );
                        console.log('[SalesOrderCreateService.updatePISalesOrderRel] 插入结果:', insertResult);
                    }
                }
            }
        } catch (error) {
            console.error('[SalesOrderCreateService.updatePISalesOrderRel] 更新或插入失败:', error);
        }
    }
}

module.exports = SalesOrderCreateService;