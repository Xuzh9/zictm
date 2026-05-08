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

            // 使用通用工具类读取之前步骤的 objkey（销售订单号）
            let salesOrder = objkey;
            const previousObjkey = await this.commonUtils.getPreviousStepObjkey(zrfcLogid, zrfcid, readsteps, canum);
            if (previousObjkey) {
                salesOrder = previousObjkey;
            }

            // 读取 ProcessConfig 表获取业务表名
            const businessTable = await this.commonUtils.getBusinessTableName(zrfcid);
            if (!businessTable) {
                return {
                    code: 'E',
                    message: `未找到业务流程配置: ${zrfcid}`,
                    objkey: ''
                };
            }

            // 读取业务表数据
            const businessDataList = await this.commonUtils.getBusinessData(businessTable, salesOrder, 'SalesOrder');
            if (!businessDataList || businessDataList.length === 0) {
                return {
                    code: 'E',
                    message: `未找到业务数据，销售订单号: ${salesOrder}`,
                    objkey: ''
                };
            }

            // 根据 zdfjy 和 canum 查找 MPTStepConfig 配置
            const mptStepConfig = await this.commonUtils.getMPTStepConfig(zdfjy, canum);

            // 构建销售订单抬头修改数据
            const headerData = this.buildHeaderData(businessDataList, mptStepConfig);

            // 获取 CSRF token（使用 OData V2 格式）
            const csrfResult = await executeHttpRequest(
                {
                    destinationName: 'ES_API'
                },
                {
                    method: 'GET',
                    url: '/sap/opu/odata/sap/API_SALES_ORDER_SRV/$metadata',
                    headers: {
                        'X-CSRF-Token': 'Fetch',
                        'Accept': 'application/json'
                    }
                }
            );

            // 提取 cookie 和 CSRF token
            const cookies = csrfResult.headers['set-cookie'] || [];
            const cookieString = cookies.map(cookie => cookie.split(';')[0]).join('; ');
            const csrfToken = csrfResult.headers['x-csrf-token'];
            
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
                        'Accept': 'application/json',
                        'Cookie': cookieString,
                        'sap-language': 'ZH'
                    },
                    validateStatus: function (status) {
                        return true;
                    }
                }
            );

            console.log('修改状态码:', result.status);

            if (result.status >= 200 && result.status < 300) {
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
        
        const headerData = {
            YY1_FD_XMYQ: firstBusinessData.YY1_FD_XMYQ,
            YY1_FD_DBFS: firstBusinessData.YY1_FD_DBFS,
            YY1_FD_FHYQ: firstBusinessData.YY1_FD_FHYQ,
            YY1_FD_FKG: firstBusinessData.YY1_FD_FKG,
            YY1_FD_JSFS: firstBusinessData.YY1_FD_JSFS,
            YY1_FD_PT: firstBusinessData.YY1_FD_PT,
            YY1_FD_SFBG: firstBusinessData.YY1_FD_SFBG,
            YY1_FD_SFHD: firstBusinessData.YY1_FD_SFHD,
            YY1_FD_TMBQ: firstBusinessData.YY1_FD_TMBQ,
            YY1_FD_YDG: firstBusinessData.YY1_FD_YDG,
            YY1_FD_YSFS: firstBusinessData.YY1_FD_YSFS,
            YY1_FD_ZTMWZ: firstBusinessData.YY1_FD_ZTMWZ,
            YY1_FD_ZH: firstBusinessData.YY1_FD_ZH,
            YY1_FD_ZDFJY: firstBusinessData.YY1_FD_ZDFJY,
        };

        return headerData;
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