const cds = require('@sap/cds');
const MultiStepInvoker = require('./handlers/MultiStepInvoker');

module.exports = (srv) => {
    /**
     * 调拨单保存后处理
     * 调用多步调用类，将返回的zrfcid存表用于后续记录对账
     */
    srv.after('CREATE', 'TransferOrder', async (req, res) => {
        try {
            // 获取调拨单ID
            const transferOrderId = res.TransferOrder;
            
            // 调用多步调用类进行处理
            const invoker = new MultiStepInvoker();
            const result = await invoker.process(transferOrderId);
            
            // 更新调拨单，保存zrfcid用于后续记录对账
            await updateTransferOrderZrfcid(transferOrderId, result.zrfcid);
            
        } catch (error) {
            console.error('StockTransferService after CREATE error:', error);
        }
    });
};

/**
 * 更新调拨单的zrfcid字段
 * @param {string} transferOrderId - 调拨单ID
 * @param {string} zrfcid - 多步调用ID
 */
async function updateTransferOrderZrfcid(transferOrderId, zrfcid) {
    const TransferOrder = cds.entities['com.sap.zictm.TransferOrder'];
    const tx = cds.transaction();
    
    try {
        await tx.run(
            UPDATE(TransferOrder)
                .set({ zrfcid })
                .where({ TransferOrder: transferOrderId })
        );
        await tx.commit();
    } catch (error) {
        await tx.rollback();
        console.error('Update TransferOrder zrfcid error:', error);
    }
}