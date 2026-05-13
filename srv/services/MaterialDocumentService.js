const cds = require('@sap/cds');
const { SELECT } = cds.ql;
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

class MaterialDocumentService {
    constructor() {
        this.zrfcLogid = null;
    }

    async initService(zrfcLogid, zrfcid, canum) {
        this.zrfcLogid = zrfcLogid;
        this.zrfcid = zrfcid;
        this.canum = canum;
    }

    async execute(inputData) {
        try {
            // 入参只包含指定字段
            const { zrfcid, canum, serviceName, readsteps, objkey, zrfcLogid } = inputData;
            
            // 保存 zrfcLogid 到实例变量，供后续查询使用
            this.zrfcLogid = zrfcLogid;

            // 读取 ProcessConfig 表获取业务表名
            const businessTable = await this.getBusinessTable(zrfcid);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }

            // 读取业务表数据
            const businessDataResult = await this.getBusinessData(businessTable, objkey);
            if (businessDataResult.code === 'E') {
                return {
                    code: 'E',
                    message: businessDataResult.message,
                    objkey: ''
                };
            }
            const businessDataList = businessDataResult.businessData;

            // 构建物料凭证数据
            const materialDocData = this.buildMaterialDocumentData(businessDataList);
 
            // 使用 SAP Cloud SDK 的 executeHttpRequest 方法获取 CSRF token
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader',
                    headers: {
                        'X-CSRF-Token': 'Fetch',
                        'Accept': 'application/json'
                    },
                }
            );

            // 提取 cookie（需要在 POST 请求中带上）
            const cookies = csrfResult.headers['set-cookie'] || [];

            // 构建 cookie 字符串
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            
            const result = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'POST',
                    url: '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader',
                    data: materialDocData,
                    headers: {
                        'X-CSRF-Token': csrfResult.headers['x-csrf-token'],
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Cookie': cookieString,
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true; // 接受所有状态码，以便查看详细的错误信息
                    }
                }
            );

            if (result.status >= 200 && result.status < 300) {
                // 从响应数据中提取物料凭证号和年度
                const docData = result.data.d || result.data;
                const materialDocument = docData.MaterialDocument || '';
                const materialDocumentYear = docData.MaterialDocumentYear || '';
                // 拼接物料凭证号+年度
                const objkey = materialDocument && materialDocumentYear ? `${materialDocument}${materialDocumentYear}` : '';
                
                return {
                    code: 'S',
                    message: '物料凭证创建成功',
                    objkey: objkey
                };
            } else {
                // 提取详细的错误信息
                let errorMessage = `API 调用失败: ${result.status}`;
                if (result.data && result.data.error) {
                    const error = result.data.error;
                    if (error.message && error.message.value) {
                        errorMessage = error.message.value;
                    } else if (error.message) {
                        errorMessage = error.message;
                    }
                    if (error.code) {
                        errorMessage = `${errorMessage} (${error.code})`;
                    }
                }
                // 限制错误消息长度，避免超过系统限制
                errorMessage = errorMessage.substring(0, 500);
                return {
                    code: 'E',
                    message: errorMessage,
                    objkey: ''
                };
            }
        } catch (error) {
            console.error('MaterialDocumentService 执行失败:', error);
            // 提取详细的错误信息
            let errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            if (error.response && error.response.data && error.response.data.error) {
                const errorData = error.response.data.error;
                if (errorData.message && errorData.message.value) {
                    errorMessage = errorData.message.value;
                } else if (errorData.message) {
                    errorMessage = errorData.message;
                }
                if (errorData.code) {
                    errorMessage = `${errorMessage} (${errorData.code})`;
                }
                // 限制错误消息长度，避免超过系统限制
                errorMessage = errorMessage.substring(0, 500);
            }
            return {
                code: 'E',
                message: errorMessage,
                objkey: ''
            };
        }
    }

    async getBusinessTable(zrfcid) {
        const ProcessConfig = cds.entities['com.sap.zictm.ProcessConfig'];
        const config = await cds.run(SELECT.one.from(ProcessConfig).where({ zrfcid }));
        return config ? config.businessTable1 : null;
    }

    async getBusinessData(businessTable, objkey) {
        try {
            // 动态获取业务表实体
            const BusinessEntity = cds.entities[businessTable];
            if (!BusinessEntity) {
                return {
                    code: 'E',
                    message: `业务表不存在: ${businessTable}`,
                    businessData: []
                };
            }

            // 根据不同业务表使用不同的查询条件
            let businessData;
            
            switch (businessTable) {
                case 'Transfer':
                    // Transfer 表优先使用 TransferOrder 作为查询条件，若为空则使用 zrfc_logid
                    if (objkey) {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ TransferOrder: objkey }));
                    } else {
                        // 第一步执行时 objkey 为空，使用 zrfc_logid 查询
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
                    }
                    break;
                case 'OutboundDelivery':
                    // OutboundDelivery 表优先使用 DeliveryDocument 作为查询条件
                    if (objkey) {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ DeliveryDocument: objkey }));
                    } else {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
                    }
                    break;
                case 'PaymentReceipt':
                    // PaymentReceipt 表优先使用 PaymentDocument 作为查询条件
                    if (objkey) {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ PaymentDocument: objkey }));
                    } else {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
                    }
                    break;
                case 'SalesOrder':
                    // SalesOrder 表优先使用 SalesOrder 作为查询条件
                    if (objkey) {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ SalesOrder: objkey }));
                    } else {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
                    }
                    break;
                case 'DeliveryActualInfo':
                    // DeliveryActualInfo 表优先使用 DeliveryDocument 作为查询条件
                    if (objkey) {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ DeliveryDocument: objkey }));
                    } else {
                        businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
                    }
                    break;
                default:
                    // 默认使用 zrfc_logid 查询
                    businessData = await cds.run(SELECT.from(BusinessEntity).where({ zrfc_logid: this.zrfcLogid }));
            }

            if (!businessData || businessData.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据: ${objkey || this.zrfcLogid}`,
                    businessData: []
                };
            }

            return {
                code: 'S',
                message: '获取业务数据成功',
                businessData
            };
        } catch (error) {
            console.error('获取业务数据失败:', error);
            return {
                code: 'E',
                message: error.message || '获取业务数据失败',
                businessData: []
            };
        }
    }

    buildMaterialDocumentData(businessDataList) {
        // 构建物料凭证头部数据（使用第一条记录的数据）
        const firstBusinessData = businessDataList[0];
        
        let formattedPostingDate;
        if (firstBusinessData.PostingDate) {
            const dateObj = new Date(firstBusinessData.PostingDate);
            // 格式：/Date(1234567890123)/
            formattedPostingDate = `/Date(${dateObj.getTime()})/`;
        } else {
            formattedPostingDate = `/Date(${new Date().getTime()})/`;
        }
        
        const header = {
            PostingDate: formattedPostingDate,
            MaterialDocumentHeaderText: firstBusinessData.Customer || '',
            ReferenceDocument: firstBusinessData.TransferOrder || '',
            GoodsMovementCode: firstBusinessData.GoodsMovementCode || ''
        };

        // 构建物料凭证行项目（循环处理每条记录）
        const items = [];
        for (const businessData of businessDataList) {
            if (businessData.Material || businessData.Product) {
                const item = {
                    Material: businessData.Material || '',
                    Plant: businessData.Plant || '',
                    StorageLocation: businessData.StorageLocation || '',
                    IssuingOrReceivingStorageLoc: businessData.IssuingOrReceivingStorageLoc || '',
                    GoodsMovementType: businessData.GoodsMovementType || '',
                    QuantityInEntryUnit: businessData.QuantityInBaseUnit || 0,
                    EntryUnit: 'PCS',
                    Batch: '0000000017',
                    MaterialDocumentItemText: businessData.TransferOrder && businessData.TransferOrderItem ? `${businessData.TransferOrder}-${businessData.TransferOrderItem}` : ''
                };

                items.push(item);
            }
        }

        if (items.length > 0) {
            header.to_MaterialDocumentItem = {
                results: items
            };
        }

        return header;
    }
}

module.exports = MaterialDocumentService;