const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
const CommonUtils = require('../handlers/CommonUtils');

class PurchaseOrderCreateService {
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

            console.log('[PurchaseOrderService] 开始执行, zrfcid:', zrfcid, 'canum:', canum, 'zdfjy:', zdfjy);

            // 读取 ProcessConfig 表获取业务表名
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid, true);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }

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
            console.log('[PurchaseOrderService] 业务数据条数:', businessDataList.length);

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 构建采购订单数据，同时获取行号映射和计算后的价格
            const { purchaseOrderData, itemPrices } = await this.buildPurchaseOrderData(businessDataList, mptStepConfig, zrfcid, zdfjy, canum);
            
            // 调试：打印请求数据
            console.log('[PurchaseOrderService] 请求数据:', JSON.stringify(purchaseOrderData, null, 2));
 
            // 获取 CSRF token
            const csrfResult = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/$metadata',
                    headers: {
                        'X-CSRF-Token': 'Fetch'
                    }
                }
            );
            console.log('[PurchaseOrderService] CSRF token 获取成功, status:', csrfResult.status);

            // 提取 cookie 和 CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];
            
            // 调试：打印请求头
            console.log('[PurchaseOrderService] 请求头:', {
                'X-CSRF-Token': csrfToken,
                'Accept': 'application/json',
                'Cookie': cookieString,
                'sap-language': 'ZH'
            });
            
            // 直接传递对象，跟 MaterialDocumentService 保持一致
            const result = await this.commonUtils.executeHttpRequestWithRetry(
                {
                    destinationName: this.commonUtils.getDestinationName()
                },
                {
                    method: 'POST',
                    url: '/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrder',
                    data: purchaseOrderData,
                    headers: {
                        'X-CSRF-Token': csrfToken,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Cookie': cookieString,
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true; // 接受所有状态码
                    }
                }
            );

            if (result.status >= 200 && result.status < 300) {
                // OData V4 响应格式
                const purchaseOrder = result.data.PurchaseOrder || '';
                
                // 根据 zrfcid 执行不同的更新操作
                if (zrfcid === 'SD01' || zrfcid === 'SD06' || zrfcid === 'SD08') {
                    // 更新 PISalesOrderRel 表
                    await this.updatePISalesOrderRel(purchaseOrder, businessDataList, itemPrices, zrfcid, canum);
                } else if (zrfcid === 'SD04' || zrfcid === 'SD11') {
                    // 更新 OutboundDelivery 的 PurchasePrice（使用之前计算好的价格）
                    await this.updateOutboundDeliveryPurchasePrice(itemPrices);
                }
                
                return {
                    code: 'S',
                    message: '采购订单创建成功',
                    objkey: purchaseOrder
                };
            } else {
                let errorMessage = `API 调用失败: ${result.status}`;
                if (result.data && result.data.error) {
                    const error = result.data.error;
                    const messages = [];
                    // 取主错误消息
                    if (error.message && error.message.value) {
                        messages.push(error.message.value);
                    } else if (error.message) {
                        messages.push(error.message);
                    }
                    // 取 details 中的消息
                    if (error.details && error.details.length > 0) {
                        const detailMessages = error.details.map(d => d.message).filter(m => m);
                        if (detailMessages.length > 0) {
                            messages.push(...detailMessages);
                        }
                    }
                    // 拼接所有消息
                    if (messages.length > 0) {
                        errorMessage = messages.join('; ');
                    }
                    if (error.code) {
                        errorMessage = `${errorMessage} (${error.code})`;
                    }
                } else if (result.data && result.data.message) {
                    errorMessage = result.data.message;
                }
                errorMessage = errorMessage.substring(0, 500);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }
        } catch (error) {
            console.error('PurchaseOrderService 执行失败:', error);
            // 调试：打印完整错误信息
            console.error('[PurchaseOrderService] 错误详情:', {
                message: error.message,
                code: error.code,
                response: error.response ? {
                    status: error.response.status,
                    headers: error.response.headers,
                    data: error.response.data
                } : null,
                config: error.config ? {
                    method: error.config.method,
                    url: error.config.url,
                    headers: error.config.headers
                } : null
            });
            let errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            if (error.response && error.response.data && error.response.data.error) {
                const errorData = error.response.data.error;
                const messages = [];
                // 取主错误消息
                if (errorData.message && errorData.message.value) {
                    messages.push(errorData.message.value);
                } else if (errorData.message) {
                    messages.push(errorData.message);
                }
                // 取 details 中的消息
                if (errorData.details && errorData.details.length > 0) {
                    const detailMessages = errorData.details.map(d => d.message).filter(m => m);
                    if (detailMessages.length > 0) {
                        messages.push(...detailMessages);
                    }
                }
                // 拼接所有消息
                if (messages.length > 0) {
                    errorMessage = messages.join('; ');
                }
                if (errorData.code) {
                    errorMessage = `${errorMessage} (${errorData.code})`;
                }
                errorMessage = errorMessage.substring(0, 500);
            }
            return {
                code: 'E',
                message: errorMessage,
                objkey: ''
            };
        }
    }

    async getBusinessData(businessTable, objkey) {
        try {
            const BusinessEntity = cds.entities[businessTable];
            
            if (!BusinessEntity) {
                return {
                    code: 'E',
                    message: `业务表实体不存在: ${businessTable}`,
                    businessData: []
                };
            }

            const businessData = await cds.run(
                SELECT.from(BusinessEntity).where({ zrfc_logid: objkey })
            );

            if (!businessData || businessData.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据: ${businessTable}, zrfc_logid=${objkey}`,
                    businessData: []
                };
            }

            return {
                code: 'S',
                message: '查询成功',
                businessData
            };
        } catch (error) {
            console.error('读取业务数据失败:', error);
            return {
                code: 'E',
                message: `读取业务数据失败: ${error.message}`,
                businessData: []
            };
        }
    }

    async buildPurchaseOrderData(businessDataList, mptStepConfig, zrfcid, zdfjy, canum = null) {
        console.log('[PurchaseOrderService] buildPurchaseOrderData - 开始执行');
        console.log('[PurchaseOrderService] buildPurchaseOrderData - zdfjy 参数值:', zdfjy);
        console.log('[PurchaseOrderService] buildPurchaseOrderData - zrfcid:', zrfcid);
        console.log('[PurchaseOrderService] buildPurchaseOrderData - mptStepConfig:', JSON.stringify(mptStepConfig));
        
        // 获取第一行数据作为主数据
        const mainData = businessDataList[0];
        
        // 判断是否为退货场景
        const isReturn = mainData.SalesOrderType === 'CBRE';
        
        // 存储计算后的价格映射，用于后续更新 OutboundDelivery 表
        const itemPrices = [];
        
        // 构建采购订单行项目数据（根据 zrfcid 使用不同的字段映射）
        const purchaseOrderItems = [];
        for (const item of businessDataList) {
            // 根据 zrfcid 选择不同的字段映射
            let poItemNumber, material, netPriceAmount, unitOfMeasure;
            switch (zrfcid) {
                case 'SD01':
                    poItemNumber = item.PIOrderItem;
                    material = item.Material || "";
                    netPriceAmount = parseFloat((item.PurchasePrice ? parseFloat(item.PurchasePrice) : 0).toFixed(2));
                    unitOfMeasure = item.RequestedQuantityUnit;
                    break;
                case 'SD04':
                case 'SD11':
                    poItemNumber = item.SalesOrderItem;
                    material = item.Product || "";
                    const netAmount = item.NetAmount ? parseFloat(item.NetAmount) : 0;
                    const requestedQty = item.RequestedQuantity ? parseFloat(item.RequestedQuantity) : 1;
                    const zjgbl = mptStepConfig?.zjgbl ? parseFloat(mptStepConfig.zjgbl) : 100;
                    netPriceAmount = parseFloat(((requestedQty > 0 ? (netAmount / requestedQty) * (zjgbl / 100) : 0)).toFixed(2));
                    // 需要通过物料主数据 API 获取单位
                    const baseUnit = await this.getMaterialBaseUnit(material);
                    unitOfMeasure = baseUnit || "EA";
                    break;
                case 'SD06':
                    poItemNumber = item.PIOrderItem;
                    material = item.Material || "";
                    const zp00Value = item.ZP00_Value ? parseFloat(item.ZP00_Value) : 0;
                    const sd06Zjgbl = mptStepConfig?.zjgbl ? parseFloat(mptStepConfig.zjgbl) : 100;
                    netPriceAmount = parseFloat((zp00Value * (sd06Zjgbl / 100)).toFixed(2));
                    unitOfMeasure = item.RequestedQuantityUnit;
                    break;
                case 'SD08': {
                    poItemNumber = item.PIOrderItem;
                    material = item.Material || "";
                    unitOfMeasure = item.RequestedQuantityUnit;
                    const step = parseInt(canum);
                    if (step === 10) {
                        netPriceAmount = parseFloat((item.PurchasePrice ? parseFloat(item.PurchasePrice) : 0).toFixed(2));
                    } else if (step === 40) {
                        const sd08Zjgbl = mptStepConfig?.zjgbl ? parseFloat(mptStepConfig.zjgbl) : 100;
                        netPriceAmount = parseFloat(((item.PurchasePrice ? parseFloat(item.PurchasePrice) : 0) * (sd08Zjgbl / 100)).toFixed(2));
                    } 
                    break;
                }
            }

            // 保存计算后的价格映射（用于后续更新）
            itemPrices.push({
                SalesOrder: item.SalesOrder,
                SalesOrderItem: item.SalesOrderItem,
                PIOrder: item.PIOrder,
                PIOrderItem: item.PIOrderItem,
                PurchasePrice: netPriceAmount
            });

            purchaseOrderItems.push({
                PurchaseOrderItem: poItemNumber || "",
                Material: material,
                Plant: isReturn ? (mptStepConfig?.lifnr || "") : (mptStepConfig?.umwrk || ""),
                StorageLocation: item.ReceivingStorageLocation || item.StorageLocation || mptStepConfig?.umlgo || "",
                PurchaseOrderQuantityUnit: unitOfMeasure || "",
                TaxCode: mptStepConfig?.mwskz || "",
                OrderQuantity: item.RequestedQuantity ? parseFloat(item.RequestedQuantity) : 0,
                //NetPriceAmount: netPriceAmount,
                //DocumentCurrency: item.TransactionCurrency || "",
                _PurchaseOrderScheduleLineTP: [{
                    PurchaseOrderItem: poItemNumber || "",
                    ScheduleLine: "1",
                    ScheduleLineDeliveryDate: zrfcid === 'SD04' || zrfcid === 'SD11' ? (item.DeliveryDate || "") : (item.ConfirmedDeliveryDate || "")
                }],
                _PurOrdPricingElement: (() => {
                    const pricingElements = [];

                    // PMP0 定价条件
                    if (netPriceAmount) {
                        pricingElements.push({
                            PurchaseOrderItem: poItemNumber || "",
                            ConditionType: "PMP0",
                            ConditionBaseAmount: netPriceAmount,
                            ConditionCurrency: item.TransactionCurrency || ""
                        });
                    }

                    // ZQU1/ZQU2 定价条件
                    if (mptStepConfig?.taxFreightAmt) {
                        pricingElements.push({
                            PurchaseOrderItem: poItemNumber || "",
                            ConditionType: "ZQU1",
                            ConditionBaseAmount: mptStepConfig.taxFreightAmt,
                            ConditionCurrency: item.TransactionCurrency || "",
                            FreightSupplier: "600000"
                        }, {
                            PurchaseOrderItem: poItemNumber || "",
                            ConditionType: "ZQU2",
                            ConditionBaseAmount: mptStepConfig.taxFreightAmt,
                            ConditionCurrency: item.TransactionCurrency || "",
                            FreightSupplier: "600000"
                        });
                    }

                    return pricingElements;
                })()
            });
        }

        // 构建采购订单主数据（包含行项目）
        console.log('[PurchaseOrderService] buildPurchaseOrderData - 即将使用 zdfjy:', zdfjy);
        console.log('[PurchaseOrderService] buildPurchaseOrderData - zdfjy 类型:', typeof zdfjy);
        
        let purchaseOrderData = {
            PurchaseOrderType: "Z09",
            PurchasingOrganization: isReturn ? (mptStepConfig?.bukrs || "") : (mptStepConfig?.ekorg || ""),
            PurchasingGroup: mptStepConfig?.ekgrp || "",
            Supplier: isReturn ? (mptStepConfig?.umwrk || "") : (mptStepConfig?.lifnr || ""),
            //DocumentCurrency: mainData.TransactionCurrency || "",
            YY1_FD_ZDFJY2_PDH: zdfjy || "",
            YY1_FD_ZRFCID_PDH: zrfcid || "",
            SupplyingPlant: isReturn ? (mptStepConfig?.umwrk || "") : (mptStepConfig?.lifnr || ""),
            _PurchaseOrderItem: purchaseOrderItems
        };

        // 只有当日期有值时才添加 PurchaseOrderDate 字段
        if (mainData.ConfirmedDeliveryDate) {
            purchaseOrderData.PurchaseOrderDate = mainData.ConfirmedDeliveryDate;
        }

        // 如果存在 MPTStepConfig，应用主数据字段映射
        if (mptStepConfig && mptStepConfig.mainDataMapping) {
            try {
                const mainDataMapping = JSON.parse(mptStepConfig.mainDataMapping);
                Object.keys(mainDataMapping).forEach(targetField => {
                    const sourceField = mainDataMapping[targetField];
                    if (mainData[sourceField] !== undefined && mainData[sourceField] !== null) {
                        purchaseOrderData[targetField] = mainData[sourceField];
                    }
                });
            } catch (e) {
                console.error('解析主数据映射失败:', e);
            }
        }

        // 返回采购订单数据和计算后的价格映射
        return { purchaseOrderData, itemPrices };
    }

    async updatePISalesOrderRel(purchaseOrder, businessDataList, itemPrices, zrfcid, canum = null) {
        try {
            const PISalesOrderRel = cds.entities['com.sap.zictm.PISalesOrderRel'];
            const { INSERT, UPDATE } = cds.ql;
            
            for (const item of businessDataList) {
                // 使用 PIOrderItem 作为采购订单行项目号，添加前导零使其长度为5位
                const poItemNumber = String(item.PIOrderItem).padStart(5, '0');
                
                // 构建更新数据
                let updateData;
                if (zrfcid === 'SD08' && canum === 40) {
                    updateData = {
                        PurchaseOrder2: purchaseOrder,
                        PurchaseOrderItem2: poItemNumber
                    };
                } else {
                    updateData = {
                        PurchaseOrder1: purchaseOrder,
                        PurchaseOrderItem1: poItemNumber
                    };
                }
                
                // 更新 SalesOrderCreate 表的 PurchasePrice
                if (zrfcid === 'SD06' && itemPrices) {
                    const SalesOrderCreate = cds.entities['com.sap.zictm.SalesOrderCreate'];
                    const priceItem = itemPrices.find(p => 
                        p.PIOrder === item.PIOrder && p.PIOrderItem === item.PIOrderItem
                    );
                    if (priceItem) {
                        await cds.run(
                            UPDATE(SalesOrderCreate)
                                .set({ PurchasePrice: priceItem.PurchasePrice })
                                .where({
                                    PIOrder: item.PIOrder,
                                    PIOrderItem: item.PIOrderItem
                                })
                        );
                        console.log(`更新 SalesOrderCreate: PIOrder=${item.PIOrder}, PIOrderItem=${item.PIOrderItem}, PurchasePrice=${priceItem.PurchasePrice}`);
                    }
                }
                
                // 先尝试更新
                const updateResult = await cds.run(
                    UPDATE(PISalesOrderRel)
                        .set(updateData)
                        .where({
                            PIOrder: item.PIOrder,
                            PIOrderItem: item.PIOrderItem
                        })
                );
                
                // 如果没有更新到数据（表中没有该记录），则插入新记录
                if (updateResult?.affectedRows === 0 || !updateResult) {
                    // 根据 zrfcid 和 step 决定使用哪些字段
                    const insertData = {
                        zrfc_logid: this.zrfcLogid,
                        PIOrder: item.PIOrder,
                        PIOrderItem: item.PIOrderItem
                    };
                    
                    if (zrfcid === 'SD08' && canum === 40) {
                        insertData.PurchaseOrder2 = purchaseOrder;
                        insertData.PurchaseOrderItem2 = poItemNumber;
                    } else {
                        insertData.PurchaseOrder1 = purchaseOrder;
                        insertData.PurchaseOrderItem1 = poItemNumber;
                    }
                    
                    await cds.run(
                        INSERT.into(PISalesOrderRel).entries(insertData)
                    );
                }
            }
            
            console.log(`已更新/插入 PISalesOrderRel 表: ${businessDataList.length} 条记录`);
        } catch (error) {
            console.error('更新 PISalesOrderRel 表失败:', error);
        }
    }

    async updateOutboundDeliveryPurchasePrice(itemPrices) {
        try {
            const OutboundDelivery = cds.entities['com.sap.zictm.OutboundDelivery'];
            
            for (const item of itemPrices) {
                // 直接使用之前计算好的价格，避免重复计算导致小数差异
                const purchasePrice = item.PurchasePrice;
                
                // 按表主键（SalesOrder + SalesOrderItem）更新 OutboundDelivery 表的 PurchasePrice 字段
                const affectedRows = await cds.run(
                    UPDATE(OutboundDelivery)
                        .set({ PurchasePrice: purchasePrice })
                        .where({ 
                            SalesOrder: item.SalesOrder,
                            SalesOrderItem: item.SalesOrderItem
                        })
                );
                
                console.log(`更新 OutboundDelivery: SalesOrder=${item.SalesOrder}, SalesOrderItem=${item.SalesOrderItem}, PurchasePrice=${purchasePrice}, 更新行数: ${affectedRows}`);
            }
        } catch (error) {
            console.error('更新 OutboundDelivery 表失败:', error);
        }
    }

    // 查询物料主数据 API 获取 BaseUnit
    async getMaterialBaseUnit(materialNumber) {
        if (!materialNumber) {
            return null;
        }
        
        try {
            const url = `/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product('${materialNumber}')`;
            console.log('[PurchaseOrderCreateService] 查询物料主数据:', url);
            
            const response = await this.commonUtils.executeHttpRequestWithRetry({
                destinationName: this.commonUtils.getDestinationName()
            }, {
                method: 'GET',
                url: url,
                headers: {
                    'sap-language': 'ZH',
                    'Accept': 'application/json'
                }
            });
            
            const baseUnit = response.data?.d?.BaseUnit;
            console.log('[PurchaseOrderCreateService] 物料主数据查询结果:', materialNumber, 'BaseUnit:', baseUnit);
            return baseUnit;
        } catch (error) {
            console.warn('[PurchaseOrderCreateService] 获取物料主数据失败:', materialNumber, error.message);
            return null;
        }
    }
}

module.exports = PurchaseOrderCreateService;
