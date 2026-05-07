const MaterialDocumentService = require('./MaterialDocumentService');
const AccountingDocumentService = require('./AccountingDocumentService');

class StepServiceFactory {
    constructor() {
        // 不再缓存服务实例，每次调用都创建新实例
    }

    /**
     * 根据服务类名获取服务实例
     * @param {string} serviceClassName - 服务类名
     * @returns {Object|null} 服务实例，如果找不到则返回 null
     */
    getService(serviceClassName) {
        if (!serviceClassName) {
            return null;
        }

        // 每次调用都创建新实例，避免状态污染
        switch (serviceClassName) {
            case 'MaterialDocumentService':
                return new MaterialDocumentService();
            case 'AccountingDocumentService':
                return new AccountingDocumentService();
            default:
                // 未知的服务类
                return null;
        }
    }
}

module.exports = StepServiceFactory;