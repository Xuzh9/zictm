const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
const CommonUtils = require('../handlers/CommonUtils');

class SalesOrderAsyncCreateService {
    constructor() {
        this.zrfcLogid = null;
        this.commonUtils = new CommonUtils();
    }

    async initService(zrfcLogid, zrfcid, canum) {
        this.zrfcLogid = zrfcLogid;
        this.zrfcid = zrfcid;
        this.canum = canum;
    }

    getApiConfig(salesOrderType) {
        switch (salesOrderType) {
            case 'CR':
                return {
                    createUrl: '/sap/opu/odata4/sap/api_creditmemorequest/srvd_a2x/sap/creditmemorequest/0001/CreditMemoRequest',
                    responseField: 'CreditMemoRequest',
                    dateField: 'CreditMemoRequestDate',
                    itemCategoryField: 'CreditMemoRequestItemCategory',
                    itemCategory: 'G2N',
                    orderTypeField: 'CreditMemoRequestType',
                    orderTypeValue: 'G2',
                    itemField: 'CreditMemoRequestItem'
                };
            case 'DR':
                return {
                    createUrl: '/sap/opu/odata4/sap/api_debitmemorequest/srvd_a2x/sap/debitmemorequest/0001/DebitMemoRequest',
                    responseField: 'DebitMemoRequest',
                    dateField: 'DebitMemoRequestDate',
                    itemCategoryField: 'DebitMemoRequestItemCategory',
                    itemCategory: 'L2N',
                    orderTypeField: 'DebitMemoRequestType',
                    orderTypeValue: 'L2',
                    itemField: 'DebitMemoRequestItem'
                };
            case 'CBRE':
                return {
                    createUrl: '/sap/opu/odata4/sap/api_customerreturn/srvd_a2x/sap/customerreturn/0001/CustomerReturn',
                    responseField: 'CustomerReturn',
                    dateField: 'CustomerReturnDate',
                    itemCategoryField: 'CustomerReturnItemCategory',
                    itemCategory: 'RENV',
                    orderTypeField: 'CustomerReturnType',
                    itemField: 'CustomerReturnItem',
                    orderTypeValue: 'CBAR',
                    isReturn: true
                };
            case 'OR':
                return {
                    createUrl: '/sap/opu/odata4/sap/api_salesorder/srvd_a2x/sap/salesorder/0001/SalesOrder',
                    responseField: 'SalesOrder',
                    dateField: 'SalesOrderDate',
                    itemCategoryField: 'SalesOrderItemCategory',
                    itemCategory: 'TAN',
                    orderTypeField: 'SalesOrderType',
                    itemField: 'SalesOrderItem',
                    orderTypeValue: 'TA'
                };
            case 'ZPR':
            default:
                return {
                    createUrl: '/sap/opu/odata4/sap/api_salesorder/srvd_a2x/sap/salesorder/0001/SalesOrder',
                    responseField: 'SalesOrder',
                    dateField: 'SalesOrderDate',
                    itemCategoryField: 'SalesOrderItemCategory',
                    itemCategory: 'TAN',
                    orderTypeField: 'SalesOrderType',
                    itemField: 'SalesOrderItem'
                };
        }
    }

    async execute(inputData) {
        try {
            const { zrfcid, canum, serviceName, readsteps, objkey, zrfcLogid, zdfjy } = inputData;
            
            this.zrfcLogid = zrfcLogid;

            console.log('[SalesOrderAsyncCreateService] 开始执行, zrfcid:', zrfcid, 'canum:', canum, 'zdfjy:', zdfjy);

            const businessTable = await this.getBusinessTable(zrfcid);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }
            console.log('[SalesOrderAsyncCreateService] 业务表名:', businessTable);

            const businessDataResult = await this.getBusinessData(businessTable, zrfcLogid);
            if (businessDataResult.code === 'E') {
                return {
                    code: 'E',
                    message: businessDataResult.message,
                    objkey: ''
                };
            }
            const businessDataList = businessDataResult.businessData;
            console.log('[SalesOrderAsyncCreateService] 业务数据条数:', businessDataList.length);

            console.log('[SalesOrderAsyncCreateService] 查询 MPTStepConfig, zdfjy:', zdfjy, ', canum:', canum);
            const mptStepConfig = await this.getMPTStepConfig(businessDataList, canum, zdfjy);
            console.log('[SalesOrderAsyncCreateService] MPTStepConfig 查询结果:', JSON.stringify(mptStepConfig));
            
            const apiConfig = this.getApiConfig(businessDataList[0]?.SalesOrderType);
            console.log('[SalesOrderAsyncCreateService] 销售订单类型:', businessDataList[0]?.SalesOrderType, ', API配置:', apiConfig);

            const salesOrderData = await this.buildSalesOrderData(businessDataList, mptStepConfig, apiConfig, zrfcid);
            
            console.log('[SalesOrderAsyncCreateService] 请求数据:', JSON.stringify(salesOrderData, null, 2));

            console.log('[SalesOrderAsyncCreateService] 开始调用异步销售订单 API...');
            const result = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'POST',
                    url: apiConfig.createUrl,
                    data: salesOrderData,
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Prefer': 'respond-async',
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            console.log('[SalesOrderAsyncCreateService] API 调用返回状态:', result.status);

            if (result.status === 202) {
                const location = result.headers?.location || result.headers?.['content-location'];
                
                console.log('[SalesOrderAsyncCreateService] 异步创建请求已接受, location:', location);

                const returnResult = {
                    code: 'S',
                    message: '异步创建请求已接受',
                    objkey: location || ''
                };
                return returnResult;
            } else if (result.status >= 200 && result.status < 300) {
                const responseData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
                const salesOrder = responseData?.[apiConfig.responseField] || responseData?.SalesOrder || '';
                
                const returnResult = {
                    code: 'S',
                    message: '销售订单创建成功',
                    objkey: salesOrder
                };
                return returnResult;
            } else {
                const errorMessage = this.parseError(result.data);
                console.error('[SalesOrderAsyncCreateService] API 调用失败:', errorMessage);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }

        } catch (error) {
            console.error('[SalesOrderAsyncCreateService] 执行失败:', error);
            return {
                code: 'E',
                message: error.message || '销售订单创建失败',
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

        if (errorData?.error?.message) {
            return errorData.error.message;
        } else if (errorData?.error?.message?.value) {
            return errorData.error.message.value;
        } else if (errorData?.message) {
            return errorData.message;
        } else {
            return JSON.stringify(errorData);
        }
    }

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
            console.error('[SalesOrderAsyncCreateService.getBusinessTable] 获取业务表名失败:', error);
            return null;
        }
    }

    async getProductBaseUnit(productId) {
        try {
            if (!productId) {
                throw new Error('物料编号为空');
            }

            const url = `/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product?$filter=Product eq '${productId}'`;
            
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
                const baseUnit = responseData?.d?.results?.[0]?.BaseUnit;
                if (!baseUnit) {
                    throw new Error(`物料 ${productId} 未找到基础单位`);
                }
                // 转换单位为 ISO 码
                let unit;
                switch (baseUnit) {
                    case 'G' : unit = 'GRM'; break;
                    case 'BOT': unit = 'BO'; break;
                    case 'ML' : unit = 'MLT'; break;
                    case 'MM' : unit = 'MMT'; break;
                    case 'KG': unit = 'KGM'; break;
                    case 'L' : unit = 'LTR'; break;
                    case 'CM' : unit = 'CMT'; break;
                    case 'M' : unit = 'MTR'; break;
                    case 'KM' : unit = 'KMT'; break;
                    default:
                        unit = baseUnit;
                        break;
                }
                console.log(`[SalesOrderAsyncCreateService] 物料 ${productId}: ${baseUnit} → ${unit}`);
                return unit;
            } else {
                throw new Error(`查询物料主数据失败，状态码: ${result.status}`);
            }
        } catch (error) {
            console.error('[SalesOrderAsyncCreateService.getProductBaseUnit] 查询物料主数据异常:', error);
            throw error;
        }
    }

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
            console.error('[SalesOrderAsyncCreateService.getBusinessData] 获取业务数据失败:', error);
            return { code: 'E', message: `获取业务数据失败: ${error.message}` };
        }
    }

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
                
                console.log('[SalesOrderAsyncCreateService.getMPTStepConfig] SalesOrganization:', salesOrganization, 'ReceivingPlant:', receivingPlant);
                
                const MPTTypeConfig = cds.entities['com.sap.zictm.MPTTypeConfig'];
                const mptTypeConfig = await cds.run(
                    SELECT.one.from(MPTTypeConfig)
                        .where({ zxsf: salesOrganization, zfcf: receivingPlant })
                );
                
                if (!mptTypeConfig) {
                    console.log('[SalesOrderAsyncCreateService.getMPTStepConfig] 未找到 MPTTypeConfig 配置');
                    return null;
                }
                
                configZdfjy = mptTypeConfig.zdfjy;
                console.log('[SalesOrderAsyncCreateService.getMPTStepConfig] 找到 zdfjy:', configZdfjy);
            }
            
            const config = await this.commonUtils.getMPTStepConfig(configZdfjy, canum);
            return config;
        } catch (error) {
            console.error('获取 MPTStepConfig 失败:', error);
            return null;
        }
    }

    async buildSalesOrderData(businessDataList, mptStepConfig, apiConfig, zrfcid) {
        if (!businessDataList || businessDataList.length === 0) {
            return {};
        }

        const mainData = businessDataList[0];
        const salesOrderType = mainData.SalesOrderType;
        
        let plantValue;
        switch (zrfcid) {
            case 'SD02':
                plantValue = mainData.ReceivingPlant;
                break;
            case 'SD04':
            case 'SD11':
                plantValue = mptStepConfig?.werks;
                break;
            case 'SD01':
            case 'SD05':
            case 'SD06':
                plantValue = mainData.ProductionPlant;
                break;
        }
        
        businessDataList.sort((a, b) => {
            const orderCompare = (a.PIOrder || '').localeCompare(b.PIOrder || '');
            return orderCompare !== 0 ? orderCompare : (a.PIOrderItem || '').localeCompare(b.PIOrderItem || '');
        });
        
        const salesOrderItems = [];
        for (const item of businessDataList) {
            const itemCategoryField = apiConfig.itemCategoryField;
            const itemCategory = apiConfig.itemCategory;
            
            const pricingElements = [];
            
            if (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') {
                const conditionTypes = ['ZB01', 'ZB02', 'ZB03', 'ZB04', 'ZC01', 'ZC02', 'ZP00'];
                
                for (const conditionType of conditionTypes) {
                    const valueField = `${conditionType}_Value`;
                    if (item[valueField]) {
                        pricingElements.push({
                            ConditionType: conditionType || "",
                            ConditionRateAmount: parseFloat(item[valueField]) || 0,
                            ConditionCurrency: item[`${conditionType}_CurrencyCode`] || item.ItemTransactionCurrency || ""
                        });
                    }
                }
            } else {
                pricingElements.push({
                    ConditionType: "ZP10",
                    ConditionRateAmount: parseFloat(item.NetAmount) || 0,
                    ConditionCurrency: item.ItemTransactionCurrency
                });
            }
            
            if (item.SalesOrderItemCategory === 'CBXN') {
                pricingElements.push({
                    ConditionType: "ZKNP",
                    ConditionRateAmount: 0,
                    ConditionCurrency: item.ItemTransactionCurrency
                });
            }
            
            let unit = item.RequestedQuantityISOUnit;
            if (!unit) {
                const productId = (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (item.Material || "") : (item.Product || "");
                unit = await this.getProductBaseUnit(productId);
                console.log(`[SalesOrderAsyncCreateService.buildSalesOrderData] 物料 ${productId} 的单位: ${unit}`);
            }
            
            const itemData = {
                Product: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (item.Material || "") : (item.Product || ""),
                RequestedQuantity: parseFloat(item.RequestedQuantity) || 0,
                RequestedQuantityISOUnit: unit || "",
                Plant: plantValue || "",
                [apiConfig.itemCategoryField]: item.SalesOrderItemCategory || itemCategory || "",
                YY1_FD_FNSKU_SDI: item.YY1_FD_FNSKU || "",
                YY1_FD_SKU_SDI: item.YY1_FD_SKU || "",
                YY1_FD_DZKB_SDI: item.YY1_FD_DZKB || "",
                _ItemPricingElement: pricingElements
            };
            
            // 库存地点字段（优先取配置表 lgort）
            if (salesOrderType !== 'CR' && salesOrderType !== 'DR') {
                itemData.StorageLocation = mptStepConfig?.lgort || item.StorageLocation || item.ReceivingStorageLocation || "";
            }
            
            if (apiConfig.isReturn) {
                itemData.Batch = "2025";
                itemData.ReturnsInspectionCode = "0001";
                itemData.CustRetItmFollowUpActivity = "0001";
                itemData.ReturnsProductHasBeenReceived = true;
                itemData.ReturnsRefundProcgMode = "I";
            }
            
            if (item.SalesOrderItemCategory === 'CBXN') {
                itemData.MatlAccountAssignmentGroup = "03";
            }
            
            if (item.ItemRemark) {
                itemData._ItemText = [{
                    Language: "ZH",
                    LongTextID: "0001",
                    LongText: item.ItemRemark
                }];
            }
            
            salesOrderItems.push(itemData);
        }

        let salesOrderData = {
            [apiConfig.orderTypeField]: apiConfig.orderTypeValue || salesOrderType || '',
            SalesOrganization: mainData.SalesOrganization || mptStepConfig?.vkorg || "",
            SalesOffice: mainData.SalesOffice || "",
            DistributionChannel: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (mainData.DistributionChannel || mptStepConfig?.vtweg || "") : (mptStepConfig?.vtweg || ""),
            OrganizationDivision: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (mainData.OrganizationDivision || mptStepConfig?.spart || "00") : (mptStepConfig?.spart || "00"),
            SoldToParty: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (mainData.SalesDistrict || mptStepConfig?.kunnr || "") : (mainData.Customer || mptStepConfig?.kunnr || ""),
            PurchaseOrderByCustomer: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (mainData.PIOrder || "") : (mainData.SalesOrder || ""),
            TransactionCurrency: mainData.TransactionCurrency || "",
            YY1_FD_ZDFJY_SDH: (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') ? (mainData.YY1_FD_ZDFJY || mptStepConfig?.zdfjy || "") : (mptStepConfig?.zdfjy || ""),
            YY1_FD_ZRFCID2_SDH: zrfcid || "",  
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
            _Item: salesOrderItems
        };
        
        if (mainData.Remark) {
            salesOrderData._Text = [{
                Language: "ZH",
                LongTextID: "TX01",
                LongText: mainData.Remark
            }];
        }
        
        if (apiConfig.dateField) {
            if (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') {
                salesOrderData[apiConfig.dateField] = new Date().toISOString().split('T')[0];
            } else if (mainData.SalesOrderDate) {
                salesOrderData[apiConfig.dateField] = typeof mainData.SalesOrderDate === 'string' ? mainData.SalesOrderDate : new Date(mainData.SalesOrderDate).toISOString().split('T')[0];
            }
        }

        // RequestedDeliveryDate
        if (salesOrderType !== 'CR' && salesOrderType !== 'DR') {
            if (zrfcid === 'SD01' || zrfcid === 'SD05' || zrfcid === 'SD06') {
                if (mainData.ConfirmedDeliveryDate) {
                    salesOrderData.RequestedDeliveryDate = typeof mainData.ConfirmedDeliveryDate === 'string' ? mainData.ConfirmedDeliveryDate : new Date(mainData.ConfirmedDeliveryDate).toISOString().split('T')[0];
                }
            } else if (mainData.DeliveryDate) {
                salesOrderData.RequestedDeliveryDate = typeof mainData.DeliveryDate === 'string' ? mainData.DeliveryDate : new Date(mainData.DeliveryDate).toISOString().split('T')[0];
            }
        }

        return salesOrderData;
    }
}

module.exports = SalesOrderAsyncCreateService;