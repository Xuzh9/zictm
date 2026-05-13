const cds = require('@sap/cds');
const RetryHandler = require('./handlers/RetryHandler');

module.exports = srv => {
    const { MultistepLog } = srv.entities;

    // 1. 执行业务逻辑（重推）
    srv.on('retryStep', MultistepLog, async (req) => {
        // 获取前端传递的完整联合主键
        const targetKey = req.params[0];
        if (!targetKey) return req.error(400, '请选择数据');

        // 执行重推
        await new RetryHandler().retry(targetKey.zrfc_logid);

        // 成功提示
        req.notify({
            message: '重推执行完成',
            severity: 'success'
        });
    });

    // 2. 核心：事务提交后，返回最新数据（前端必刷新）
    srv.after('retryStep', MultistepLog, async (_, req) => {
        // 从请求参数中获取主键（安全无并发问题）
        const targetKey = req.params[0];
        
        // 用完整联合主键查询 → 前端100%匹配刷新
        return SELECT.one(MultistepLog).where(targetKey);
    });
};