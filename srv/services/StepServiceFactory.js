const MaterialDocumentService = require('./MaterialDocumentService');
const AccountingDocumentService = require('./AccountingDocumentService');
const PurchaseOrderCreateService = require('./PurchaseOrderCreateService');
const PurchaseOrderItemUpdateService = require('./PurchaseOrderItemUpdateService');
const PurchaseOrderScheduleLineUpdateService = require('./PurchaseOrderScheduleLineUpdateService');
const SalesOrderCreateService = require('./SalesOrderCreateService');
const ProductionOrderCreateService = require('./ProductionOrderCreateService');
const ProductionOrderUpdateService = require('./ProductionOrderUpdateService');
const SalesOrderHeaderUpdateService = require('./SalesOrderHeaderUpdateService');
const SalesOrderItemUpdateService = require('./SalesOrderItemUpdateService');
const SalesOrderPricingUpdateService = require('./SalesOrderPricingUpdateService');
const SalesOrderQueryService = require('./SalesOrderQueryService');
const DeliveryOrderCreateService = require('./DeliveryOrderCreateService');
const DeliveryOrderPostingService = require('./DeliveryOrderPostingService');
const DeliveryOrderHeaderUpdateService = require('./DeliveryOrderHeaderUpdateService');
const DeliveryOrderQueryService = require('./DeliveryOrderQueryService');
const DeliveryOrderItemUpdateService = require('./DeliveryOrderItemUpdateService');
const InboundDeliveryPutawayService = require('./InboundDeliveryPutawayService');

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
            case 'PurchaseOrderService':
            case 'PurchaseOrderCreateService':
                return new PurchaseOrderCreateService();
            case 'PurchaseOrderItemUpdateService':
                return new PurchaseOrderItemUpdateService();
            case 'PurchaseOrderScheduleLineUpdateService':
                return new PurchaseOrderScheduleLineUpdateService();
            case 'SalesOrderCreateService':
                return new SalesOrderCreateService();
            case 'ProductionOrderCreateService':
                return new ProductionOrderCreateService();
            case 'ProductionOrderUpdateService':
                return new ProductionOrderUpdateService();
            case 'SalesOrderHeaderUpdateService':
                return new SalesOrderHeaderUpdateService();
            case 'SalesOrderItemUpdateService':
                return new SalesOrderItemUpdateService();
            case 'SalesOrderPricingUpdateService':
                return new SalesOrderPricingUpdateService();
            case 'SalesOrderQueryService':
                return new SalesOrderQueryService();
            case 'DeliveryOrderCreateService':
                return new DeliveryOrderCreateService();
            case 'DeliveryOrderPostingService':
                return new DeliveryOrderPostingService();
            case 'DeliveryOrderHeaderUpdateService':
                return new DeliveryOrderHeaderUpdateService();
            case 'DeliveryOrderQueryService':
                return new DeliveryOrderQueryService();
            case 'DeliveryOrderItemUpdateService':
                return new DeliveryOrderItemUpdateService();
            case 'InboundDeliveryPutawayService':
                return new InboundDeliveryPutawayService();
            default:
                // 未知的服务类
                return null;
        }
    }
}

module.exports = StepServiceFactory;