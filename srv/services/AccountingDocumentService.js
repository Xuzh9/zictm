const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;
const CommonUtils = require('../handlers/CommonUtils');

// --------------------------
// 常量定义
// --------------------------
// 会计凭证最大行数限制为 999，每行业务数据生成约 2 行会计凭证行项目
// 因此每批最多处理 490 行业务数据（490 * 2 = 980 < 999）
const MAX_LINES_PER_DOC = 490;
class AccountingDocumentService {
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

            // --------------------------
            // 分批处理逻辑
            // 会计凭证最大行数: 999
            // 每行业务数据生成约 2 行会计凭证行项目
            // 因此每批最多处理 490 行业务数据
            // --------------------------
            const batches = [];
            
            for (let i = 0; i < businessDataList.length; i += MAX_LINES_PER_DOC) {
                batches.push(businessDataList.slice(i, i + MAX_LINES_PER_DOC));
            }

            console.log(`业务数据共 ${businessDataList.length} 行，将分成 ${batches.length} 批处理`);

            let lastObjkey = ''; // 只返回最后一张会计凭证号

            // 逐批处理
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batchData = batches[batchIndex];
                console.log(`处理第 ${batchIndex + 1}/${batches.length} 批，数据量: ${batchData.length} 行`);

                // 构建会计凭证 SOAP 请求数据
                const soapRequest = await this.buildSoapRequest(batchData);
 
                // 使用 SAP Cloud SDK 的 executeHttpRequest 方法调用 SOAP 接口
                console.log('开始调用 SOAP 接口 journalentrycreaterequestconfi...');
                console.log('SOAP 请求数据:', soapRequest);
                
                const result = await this.commonUtils.executeHttpRequestWithRetry(
                    {
                        destinationName: this.commonUtils.getDestinationName()
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
                // 输出完整响应数据用于调试
                const responseDataStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
                console.log('SOAP 响应数据长度:', responseDataStr.length);
                console.log('SOAP 响应数据:', responseDataStr.length > 2000 ? responseDataStr.substring(0, 2000) + '...[截断]' : responseDataStr);

                if (result.status >= 200 && result.status < 300) {
                    // 解析 SOAP 响应，提取会计凭证号
                    const { objkey: currentObjkey, docNumber } = this.extractAccountingDocumentNumber(responseDataStr);
                    
                    // 调试日志：确认提取的凭证号
                    console.log(`提取的会计凭证号 objkey: "${currentObjkey}", docNumber: "${docNumber}"`);
                    
                    // 更新最后一个凭证号
                    lastObjkey = currentObjkey;

                    // 将当前批次的会计凭证号更新到业务表的 AccountingDocument 字段
                    await this.updateAccountingDocument(businessTable, batchData, docNumber);
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
                        message: `第 ${batchIndex + 1} 批处理失败: ${errorMessage}`,
                        objkey: lastObjkey // 返回已成功创建的最后一个凭证号
                    };
                }
            }

            // 所有批次处理完成，返回最后一个凭证号
            return {
                code: 'S',
                message: '会计凭证创建成功',
                objkey: lastObjkey
            };
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

    async getProfitCenter(costCenter) {
        try {
            const result = await this.commonUtils.executeHttpRequestWithRetry(
                { destinationName: this.commonUtils.getDestinationName() },
                {
                    method: 'GET',
                    url: `/sap/opu/odata/sap/YY1_CD_COSTCENTER_CDS/YY1_CD_CostCenter?$filter=CostCenter eq '${encodeURIComponent(costCenter)}'`,
                    headers: {
                        'Content-Type': 'application/json',
                        'sap-language': 'ZH'
                    }
                }
            );
            
            if (result.data && result.data.d && result.data.d.results && result.data.d.results.length > 0) {
                const profitCenter = result.data.d.results[0].ProfitCenter;
                console.log('[AccountingDocumentService] 获取利润中心成功:', costCenter, '->', profitCenter);
                return profitCenter;
            }
            console.warn('[AccountingDocumentService] 未找到利润中心:', costCenter);
            return null;
        } catch (error) {
            console.warn('[AccountingDocumentService] 获取利润中心失败:', error.message);
            return null;
        }
    }

    async buildSoapRequest(businessDataList) {
        // 构建 SOAP 请求体 - 根据 SAP API Business Hub 官方文档格式
        const firstBusinessData = businessDataList[0];
        const currentDate = new Date();
        
        // 业务日期已为 YYYY-MM-DD 格式，直接使用；若无则使用当前日期
        const businessDate = firstBusinessData.businessDate || currentDate.toISOString().substring(0, 10);
        
        // 构建会计凭证行项目
        let debtorLines = ''; // 客户行
        let itemLines = ''; // 费用行
        let itemNumber = 1; // 统一的行号（客户行和费用行配对使用）
        let debitCreditCode = ''; // 借贷方变量
        let amount = 0; // 金额变量

        // 第一次循环
        for (const item of businessDataList) {
            const itemDocType = item.documentType || '';
            switch (itemDocType) {
                case 'YSD02_SYS':
                case 'SKDLX01_SYS': {
                    if (itemDocType === 'YSD02_SYS') {
                        debitCreditCode = item.incomeExpenseType === '01' ? 'S' : 'H';
                    } else {
                        debitCreditCode = item.incomeExpenseType === '01' ? 'H' : 'S';
                    }
                    amount = debitCreditCode === 'H' ? (item.receivableAmount || 0) * -1 : (item.receivableAmount || 0);
                    
                    debtorLines += `
                        <DebtorItem>
                            <ReferenceDocumentItem>${itemNumber}</ReferenceDocumentItem>
                            <AmountInTransactionCurrency currencyCode="${item.currency || ''}">${amount}</AmountInTransactionCurrency>
                            <DebitCreditCode>${debitCreditCode}</DebitCreditCode>
                            <Debtor>${item.receivingUnit || ''}</Debtor>
                            <DocumentItemText>${item.itemRemark || ''}</DocumentItemText>
                            <AssignmentReference>${item.receivingUnit || ''}</AssignmentReference>
                        </DebtorItem>
                    `;
                    itemNumber += 1;
                    break;
                }
                case 'SKDLX02_SYS': {
                    debitCreditCode = item.incomeExpenseType === '01' ? 'H' : 'S';
                    amount = debitCreditCode === 'H' ? (item.receivableAmount || 0) * -1 : (item.receivableAmount || 0);
                    
                    itemLines += `
                        <Item>
                            <ReferenceDocumentItem>${itemNumber}</ReferenceDocumentItem>
                            <GLAccount>${item.generalLedgerAccountNonCash}</GLAccount>
                            <AmountInTransactionCurrency currencyCode="${item.currency}">${amount}</AmountInTransactionCurrency>
                            <DebitCreditCode>${debitCreditCode}</DebitCreditCode>
                            <DocumentItemText>${item.itemRemark}</DocumentItemText>
                        </Item>
                    `;
                    itemNumber += 1;
                    break;
                }
                case 'FKDLX02_SYS':
                case 'SKTKDLX01_SYS':
                case 'SKTKDLX02_SYS':
                case 'FKTKDLX02_SYS':
                case 'FKTKDLX03_SYS': {
                    // 正常借贷方
                    debitCreditCode = item.incomeExpenseType === '01' ? 'S' : 'H';
                    amount = debitCreditCode === 'H' ? (item.receivableAmount || 0) * -1 : (item.receivableAmount || 0);
                    
                    itemLines += `
                        <Item>
                            <ReferenceDocumentItem>${itemNumber}</ReferenceDocumentItem>
                            <GLAccount>${item.generalLedgerAccountCash}</GLAccount>
                            <AmountInTransactionCurrency currencyCode="${item.currency}">${amount}</AmountInTransactionCurrency>
                            <DebitCreditCode>${debitCreditCode}</DebitCreditCode>
                            <DocumentItemText>${item.itemRemark}</DocumentItemText>
                            <FinancialTransactionType>${item.financialTransactionType || ''}</FinancialTransactionType>
                        </Item>
                    `;
                    itemNumber += 1;
                    break;
                }
            }
        }

        // 第二次循环
        for (const item of businessDataList) {
            const documentType = item.documentType || '';
            const gl = String(item.generalLedgerAccountNonCash || '');
            
            switch (documentType) {
                case 'YSD02_SYS':
                case 'FKDLX02_SYS':
                case 'FKTKDLX02_SYS': {
                    let assignmentReference = '';
                    let profitCenter = '';
                    if (gl.startsWith('600')) {
                        profitCenter = await this.getProfitCenter(item.expenseResponsibleDepartment) || '';
                        assignmentReference = item.expenseResponsibleDepartment;
                    } else if (gl.startsWith('800')|| gl.startsWith('65') || gl.startsWith('2221')) {
                        assignmentReference = item.receivingUnit;
                    }
                    
                    // 设置借贷方变量
                    debitCreditCode = item.incomeExpenseType === '02' ? 'S' : 'H';
                    // 贷方(H)时金额乘-1
                    amount = debitCreditCode === 'H' ? (item.receivableAmount || 0) * -1 : (item.receivableAmount || 0);

                    itemLines += `
                        <Item>
                            <ReferenceDocumentItem>${itemNumber}</ReferenceDocumentItem>
                            <GLAccount>${item.generalLedgerAccountNonCash}</GLAccount>
                            <AmountInTransactionCurrency currencyCode="${item.currency}">${amount}</AmountInTransactionCurrency>
                            <DebitCreditCode>${debitCreditCode}</DebitCreditCode>
                            <DocumentItemText>${item.itemRemark}</DocumentItemText>
                            <AssignmentReference>${assignmentReference}</AssignmentReference>
                            ${(gl.startsWith('600') || gl.startsWith('800')) ? `<AccountAssignment>${gl.startsWith('600') ? `<ProfitCenter>${profitCenter}</ProfitCenter>` : ''}${gl.startsWith('800') ? `<CostCenter>${item.expenseResponsibleDepartment}</CostCenter>` : ''}</AccountAssignment>` : ''}
                            ${gl.startsWith('600') ? `<ProfitabilitySupplement><Customer>${item.receivingUnit}</Customer></ProfitabilitySupplement>` : ''}
                        </Item>
                    `;
                    itemNumber += 1;
                    break;
                }
                case 'SKDLX01_SYS':
                case 'SKDLX02_SYS': {
                    // 设置借贷方变量
                    debitCreditCode = item.incomeExpenseType === '01' ? 'S' : 'H';
                    // 贷方(H)时金额乘-1
                    amount = debitCreditCode === 'H' ? (item.receivableAmount || 0) * -1 : (item.receivableAmount || 0);
                    
                    itemLines += `
                        <Item>
                            <ReferenceDocumentItem>${itemNumber}</ReferenceDocumentItem>
                            <GLAccount>${item.generalLedgerAccountCash}</GLAccount>
                            <AmountInTransactionCurrency currencyCode="${item.currency}">${amount}</AmountInTransactionCurrency>
                            <DebitCreditCode>${debitCreditCode}</DebitCreditCode>
                            <DocumentItemText>${item.itemRemark}</DocumentItemText>
                            <FinancialTransactionType>${item.financialTransactionType || ''}</FinancialTransactionType>
                        </Item>
                    `;
                    itemNumber += 1;
                    break;
                }
                case 'SKTKDLX01_SYS': {
                    // 设置借贷方变量
                    debitCreditCode = item.incomeExpenseType === '01' ? 'H' : 'S';
                    // 贷方(H)时金额乘-1
                    amount = debitCreditCode === 'H' ? (item.receivableAmount || 0) * -1 : (item.receivableAmount || 0);
                    
                    const glNonCash = String(item.generalLedgerAccountNonCash || '');
                    if (glNonCash === '1122010000') {
                        // 生成客户行                       
                        debtorLines += `
                            <DebtorItem>
                                <ReferenceDocumentItem>${itemNumber}</ReferenceDocumentItem>
                                <AmountInTransactionCurrency currencyCode="${item.currency || ''}">${amount}</AmountInTransactionCurrency>
                                <DebitCreditCode>${debitCreditCode}</DebitCreditCode>
                                <Debtor>${item.receivingUnit || ''}</Debtor>
                                <DocumentItemText>${item.itemRemark || ''}</DocumentItemText>
                                <AssignmentReference>${item.receivingUnit || ''}</AssignmentReference>
                            </DebtorItem>
                        `;
                    } else {
                        // 生成费用行
                        itemLines += `
                            <Item>
                                <ReferenceDocumentItem>${itemNumber}</ReferenceDocumentItem>
                                <CompanyCode>${item.salesOrganization || item.procurementOrganization || firstBusinessData.receivingOrganization || ''}</CompanyCode>
                                <GLAccount>${item.generalLedgerAccountNonCash}</GLAccount>
                                <AmountInTransactionCurrency currencyCode="${item.currency}">${amount}</AmountInTransactionCurrency>
                                <DebitCreditCode>${debitCreditCode}</DebitCreditCode>
                                <DocumentItemText>${item.itemRemark}</DocumentItemText>
                                <AssignmentReference>${item.receivingUnit || ''}</AssignmentReference>
                            </Item>
                        `;
                    }
                    itemNumber += 1;
                    break;
                }
                case 'SKTKDLX02_SYS': 
                case 'FKTKDLX03_SYS': {
                    // 设置借贷方变量
                    debitCreditCode = item.incomeExpenseType === '01' ? 'H' : 'S';
                    // 贷方(H)时金额乘-1
                    amount = debitCreditCode === 'H' ? (item.receivableAmount || 0) * -1 : (item.receivableAmount || 0);
                    
                    itemLines += `
                         <Item>
                            <ReferenceDocumentItem>${itemNumber}</ReferenceDocumentItem>
                            <GLAccount>${item.generalLedgerAccountNonCash}</GLAccount>
                            <AmountInTransactionCurrency currencyCode="${item.currency}">${amount}</AmountInTransactionCurrency>
                            <DebitCreditCode>${debitCreditCode}</DebitCreditCode>
                            <DocumentItemText>${item.itemRemark}</DocumentItemText>
                            <AssignmentReference>${item.receivingUnit || ''}</AssignmentReference>
                         </Item>
                    `;
                    itemNumber += 1;
                    break;
                }
            }
        }
        // 完整的 SOAP 请求 (根据 SAP JournalEntryBulkCreateRequest 官方格式)
        const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
            <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sfin="http://sap.com/xi/SAPSCORE/SFIN">
                <soapenv:Header/>
                <soapenv:Body>
                    <sfin:JournalEntryBulkCreateRequest>
                        <MessageHeader>
                            <CreationDateTime>${currentDate.toISOString()}</CreationDateTime>
                        </MessageHeader>
                        <JournalEntryCreateRequest>
                            <MessageHeader>
                                <CreationDateTime>${currentDate.toISOString()}</CreationDateTime>
                            </MessageHeader>
                            <JournalEntry>
                                <OriginalReferenceDocumentType>BKPFF</OriginalReferenceDocumentType>
                                <BusinessTransactionType>RFBU</BusinessTransactionType>
                                <AccountingDocumentType>SA</AccountingDocumentType>
                                <!-- <DocumentHeaderText>${firstBusinessData.paymentPurpose}</DocumentHeaderText> -->
                                <CreatedByUser>CC0000000002</CreatedByUser>
                                <CompanyCode>${firstBusinessData.salesOrganization || firstBusinessData.procurementOrganization || firstBusinessData.receivingOrganization || ''}</CompanyCode>
                                <DocumentDate>${currentDate.toISOString().substring(0, 10)}</DocumentDate>
                                <PostingDate>${businessDate}</PostingDate>
                                <ExchangeRateDate>${businessDate}</ExchangeRateDate>
                                <DocumentReferenceID>${firstBusinessData.paymentReceiptNo}</DocumentReferenceID>
                                ${debtorLines}
                                ${itemLines}
                            </JournalEntry>
                        </JournalEntryCreateRequest>
                    </sfin:JournalEntryBulkCreateRequest>
                </soapenv:Body>
            </soapenv:Envelope>`;

        return soapRequest;
    }

    extractAccountingDocumentNumber(responseData) {
        // 从 SOAP 响应中提取会计凭证号
        // 根据实际响应格式，使用 <AccountingDocument> 标签
        // objkey 格式: AccountingDocument + CompanyCode + FiscalYear
        // 考虑可能存在命名空间前缀，如 <n0:AccountingDocument>
        const docNumberMatch = responseData.match(/<[^>]*AccountingDocument[^>]*>([^<]+)<\/[^>]*AccountingDocument[^>]*>/);
        const companyCodeMatch = responseData.match(/<[^>]*CompanyCode[^>]*>([^<]+)<\/[^>]*CompanyCode[^>]*>/);
        const fiscalYearMatch = responseData.match(/<[^>]*FiscalYear[^>]*>([^<]+)<\/[^>]*FiscalYear[^>]*>/);
        
        // 检查SAP响应中的错误日志
        const logError = this.parseSapLogError(responseData);
        if (logError) {
            throw new Error(`SAP错误: ${logError}`);
        }
        
        // 验证凭证号是否有效（不是全零）
        if (docNumberMatch) {
            const docNumber = docNumberMatch[1].trim();
            // 检查是否为有效的凭证号（不是全零）
            if (docNumber !== '0000000000' && docNumber !== '0') {
                const companyCode = companyCodeMatch ? companyCodeMatch[1].trim() : '';
                const fiscalYear = fiscalYearMatch ? fiscalYearMatch[1].trim() : '';
                // 拼接格式: AccountingDocument + CompanyCode + FiscalYear
                const objkey = `${docNumber}${companyCode}${fiscalYear}`;
                return { objkey, docNumber };
            }
        }
        
        throw new Error('会计凭证创建失败: SAP返回空凭证号或全零凭证号');
    }
    
    parseSapLogError(responseData) {
        // 解析SAP响应中的错误日志
        // <MaximumLogItemSeverityCode>3</MaximumLogItemSeverityCode> 表示有错误
        // <Note>标签包含具体错误消息
        
        // 检查错误级别代码 (3=错误, 2=警告, 1=信息)
        const severityCodeMatch = responseData.match(/<[^>]*MaximumLogItemSeverityCode[^>]*>([^<]+)<\/[^>]*MaximumLogItemSeverityCode[^>]*>/);
        console.log('[parseSapLogError] severityCodeMatch:', severityCodeMatch);
        
        if (severityCodeMatch) {
            const severityCode = parseInt(severityCodeMatch[1].trim());
            console.log('[parseSapLogError] severityCode:', severityCode);
            
            // 如果是错误级别 (3)，提取所有错误消息
            if (severityCode >= 3) {
                // 使用 matchAll 提取所有 <Note> 标签中的错误消息
                const noteMatches = [...responseData.matchAll(/<[^>]*Note[^>]*>([^<]+)<\/[^>]*Note[^>]*>/g)];
                
                if (noteMatches && noteMatches.length > 0) {
                    // 提取所有错误消息，用分号分隔
                    const errorNotes = noteMatches.map(match => match[1].trim()).join('; ');
                    console.log('[parseSapLogError] 提取到所有错误信息:', errorNotes);
                    return errorNotes;
                }
            }
        }
        
        console.log('[parseSapLogError] 未提取到错误信息');
        return null;
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

    /**
     * 将会计凭证号批量更新到业务表的 AccountingDocument 字段
     * @param {string} businessTable - 业务表名
     * @param {Array} batchData - 当前批次的业务数据
     * @param {string} accountingDocument - 会计凭证号（纯凭证号，不含公司代码和年度）
     */
    async updateAccountingDocument(businessTable, batchData, accountingDocument) {
        try {
            if (!businessTable || !batchData || !accountingDocument || batchData.length === 0) {
                console.warn('updateAccountingDocument 参数不完整或数据为空，跳过更新');
                return;
            }

            const BusinessEntity = cds.entities[businessTable];
            if (!BusinessEntity) {
                console.error(`业务表实体不存在: ${businessTable}`);
                return;
            }

            let updatedCount = 0;
            for (const item of batchData) {
                if (!item.paymentReceiptNo || !item.paymentReceiptNoItem) {
                    console.warn('业务数据缺少主键字段，跳过该条记录');
                    continue;
                }

                const result = await cds.run(
                    UPDATE(BusinessEntity)
                        .set({ AccountingDocument: accountingDocument })
                        .where({
                            paymentReceiptNo: item.paymentReceiptNo,
                            paymentReceiptNoItem: item.paymentReceiptNoItem
                        })
                );

                if (result > 0) {
                    updatedCount++;
                }
                console.log(`更新 PaymentReceipt: paymentReceiptNo=${item.paymentReceiptNo}, paymentReceiptNoItem=${item.paymentReceiptNoItem}, AccountingDocument=${accountingDocument}, 结果=${result}`);
            }

            console.log(`成功批量更新 ${updatedCount}/${batchData.length} 条数据的 AccountingDocument 字段为: ${accountingDocument}`);
        } catch (error) {
            console.error('批量更新 AccountingDocument 字段失败:', error);
        }
    }
}

module.exports = AccountingDocumentService;
    