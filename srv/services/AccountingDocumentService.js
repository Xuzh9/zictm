const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

class AccountingDocumentService {
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

            // 构建会计凭证 SOAP 请求数据
            const soapRequest = this.buildSoapRequest(businessDataList);
 
            // 使用 SAP Cloud SDK 的 executeHttpRequest 方法调用 SOAP 接口
            console.log('开始调用 SOAP 接口 journalentrycreaterequestconfi...');
            console.log('SOAP 请求数据:', soapRequest);
            
            const result = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'POST',
                    url: '/sap/bc/srt/scs_ext/sap/journalentrycreaterequestconfi',
                    data: soapRequest,
                    headers: {
                        'Content-Type': 'text/xml; charset=UTF-8',
                        'SOAPAction': 'http://sap.com/xi/SAPSCORE/SFIN/JournalEntryBulkCreateRequest',
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true; // 接受所有状态码，以便查看详细的错误信息
                    }
                }
            );
            
            console.log('SOAP 请求状态码:', result.status);
            console.log('SOAP 响应头:', result.headers);
            // 只输出响应数据的前 1000 个字符，避免日志过长
            const responseDataStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
            console.log('SOAP 响应数据:', responseDataStr.length > 1000 ? responseDataStr.substring(0, 1000) + '...' : responseDataStr);

            if (result.status >= 200 && result.status < 300) {
                // 解析 SOAP 响应，提取会计凭证号
                const responseDataStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
                const objkey = this.extractAccountingDocumentNumber(responseDataStr);
                
                return {
                    code: 'S',
                    message: '会计凭证创建成功',
                    objkey: objkey
                };
            } else {
                // 提取详细的错误信息
                let errorMessage = `SOAP API 调用失败: ${result.status}`;
                const responseDataStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
                // 解析 SOAP 错误响应
                const errorInfo = this.parseSoapError(responseDataStr);
                if (errorInfo) {
                    errorMessage = errorInfo;
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
            console.error('AccountingDocumentService 执行失败:', error);
            console.error('错误响应状态码:', error.response ? error.response.status : 'No status');
            // 只输出错误响应数据的前 1000 个字符，避免日志过长
            if (error.response && error.response.data) {
                const errorDataStr = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
                console.error('错误响应数据:', errorDataStr.length > 1000 ? errorDataStr.substring(0, 1000) + '...' : errorDataStr);
            }
            // 提取详细的错误信息
            let errorMessage = error.message ? error.message.substring(0, 500) : '未知错误';
            if (error.response && error.response.data) {
                const errorDataStr = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
                const errorInfo = this.parseSoapError(errorDataStr);
                if (errorInfo) {
                    errorMessage = errorInfo;
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
            
            let businessData;
            console.log(`查询业务数据: businessTable=${businessTable}, objkey=${objkey}, zrfcLogid=${this.zrfcLogid}`);

            if (objkey) {
                businessData = await cds.run(SELECT.from(BusinessEntity).where({ paymentReceiptNo: objkey }));
            } else {
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

    buildSoapRequest(businessDataList) {
        // 构建 SOAP 请求体 - 根据 SAP API Business Hub 官方文档格式
        const firstBusinessData = businessDataList[0];
        const currentDate = new Date();
        
        // 获取业务日期 (YYYY-MM-DD 格式)
        let formattedbusinessDate;
        if (firstBusinessData.businessDate) {
            // 业务日期格式: 2026-04-27T09:00:00Z，直接截取前10位
            const businessDateStr = String(firstBusinessData.businessDate);
            formattedbusinessDate = businessDateStr.substring(0, 10);
        } else {
            formattedbusinessDate = currentDate.toISOString().substring(0, 10);
        }
        
        // 构建会计凭证行项目 - 每条业务数据生成客户行 + 费用行
        let lineItems = '';
        let itemNumber = 1;

        for (const businessData of businessDataList) {
            const amount = businessData.NetAmount || businessData.receivableAmount || 0;
            const currency = businessData.TransactionCurrency || businessData.currency || 'CNY';
            const glAccount = businessData.generalLedgerAccountCash || businessData.generalLedgerAccountNonCash || '10010100';

            // 1. 客户行结构 (DebtorItem)
            lineItems += `
                <sfin:DebtorItem>
                    <sfin:ReferenceDocumentItem>${itemNumber}</sfin:ReferenceDocumentItem>
                    <sfin:CompanyCode>${firstBusinessData.receivingOrganization}</sfin:CompanyCode>
                    <sfin:AmountInTransactionCurrency>${firstBusinessData.receivableAmount * -1}</sfin:AmountInTransactionCurrency>
                    <sfin:TransactionCurrency>${firstBusinessData.currency}</sfin:TransactionCurrency>
                    <sfin:DebitCreditCode>H</sfin:DebitCreditCode>
                    <sfin:Debtor>${firstBusinessData.payingUnit}</sfin:Debtor>
                </sfin:DebtorItem>
            `;
            itemNumber += 1;

            // 2. 费用行结构 (Item)
            lineItems += `
                <sfin:Item>
                    <sfin:ReferenceDocumentItem>${itemNumber}</sfin:ReferenceDocumentItem>
                    <sfin:CompanyCode>${firstBusinessData.receivingOrganization}</sfin:CompanyCode>
                    <sfin:GLLAccount>1002010000</sfin:GLLAccount>
                    <sfin:AmountInTransactionCurrency>${firstBusinessData.receivableAmount}</sfin:AmountInTransactionCurrency>
                    <sfin:TransactionCurrency>${firstBusinessData.currency}</sfin:TransactionCurrency>
                    <sfin:DebitCreditCode>S</sfin:DebitCreditCode>
                    <sfin:ReasonCode>050</sfin:ReasonCode>
                </sfin:Item>
            `;
            itemNumber += 1;
        }

        // 完整的 SOAP 请求 (根据 SAP JournalEntryBulkCreateRequest 官方格式)
        const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sfin="http://sap.com/xi/SAPSCORE/SFIN">
    <soapenv:Header/>
    <soapenv:Body>
        <sfin:JournalEntryBulkCreateRequest>
            <sfin:MessageHeader>
                <sfin:CreationDateTime>${currentDate.toISOString()}</sfin:CreationDateTime>
            </sfin:MessageHeader>
            <sfin:JournalEntryCreateRequest>
                <sfin:MessageHeader>
                    <sfin:CreationDateTime>${currentDate.toISOString()}</sfin:CreationDateTime>
                </sfin:MessageHeader>
                <sfin:JournalEntry>
                    <sfin:BusinessTransactionType>RV</sfin:BusinessTransactionType>
                    <sfin:AccountingDocumentType>SA</sfin:AccountingDocumentType>
                    <sfin:DocumentHeaderText>${firstBusinessData.paymentPurpose}</sfin:DocumentHeaderText>
                    <sfin:CreatedByUser>CC0000000002</sfin:CreatedByUser>
                    <sfin:CompanyCode>${firstBusinessData.receivingOrganization}</sfin:CompanyCode>
                    <sfin:DocumentDate>${formattedbusinessDate}</sfin:DocumentDate>
                    <sfin:PostingDate>${formattedbusinessDate}</sfin:PostingDate>
                    <sfin:DocumentReferenceID>${firstBusinessData.paymentReceiptNo}</sfin:DocumentReferenceID>
                    ${lineItems}
                </sfin:JournalEntry>
            </sfin:JournalEntryCreateRequest>
        </sfin:JournalEntryBulkCreateRequest>
    </soapenv:Body>
</soapenv:Envelope>`;

        return soapRequest;
    }

    extractAccountingDocumentNumber(responseData) {
        // 从 SOAP 响应中提取会计凭证号
        // 响应格式通常包含 <DocumentNumber> 标签
        const docNumberMatch = responseData.match(/<DocumentNumber>([^<]+)<\/DocumentNumber>/);
        const fiscalYearMatch = responseData.match(/<FiscalYear>([^<]+)<\/FiscalYear>/);
        
        if (docNumberMatch && fiscalYearMatch) {
            return `${docNumberMatch[1]}${fiscalYearMatch[1]}`;
        } else if (docNumberMatch) {
            return docNumberMatch[1];
        }
        
        return '';
    }

    parseSoapError(responseData) {
        // 解析 SOAP 错误响应
        // 错误通常在 <faultstring> 或 <Message> 标签中
        const faultStringMatch = responseData.match(/<faultstring>([^<]+)<\/faultstring>/);
        const messageMatch = responseData.match(/<Message>([^<]+)<\/Message>/);
        const errorMessageMatch = responseData.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/);
        
        if (faultStringMatch) {
            return faultStringMatch[1];
        } else if (messageMatch) {
            return messageMatch[1];
        } else if (errorMessageMatch) {
            return errorMessageMatch[1];
        }
        
        return null;
    }
}

module.exports = AccountingDocumentService;