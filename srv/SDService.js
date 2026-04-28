module.exports = cds.service.impl(async function () {
  const { Transfer,PaymentReceipt,OutboundDelivery } = this.entities;
  //调拨单
  this.on('TrCreate', async (req) => {
    const { data } = req.data;
    if (!data || data.length === 0) req.error(400, "数据不能为空");

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.TransferOrder) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：TransferOrder`);
      }
      if (!item.TransferOrderItem) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：TransferOrderItem`);
      }
    });

    // --------------------------
    // 批量内重复主键校验
    // --------------------------
    const keyMap = new Map();
    data.forEach((item, index) => {
      const rowNum = index + 1;
      const key = `${item.TransferOrder}-${item.TransferOrderItem}`;
      if (keyMap.has(key)) {
        req.error(400, `第 ${rowNum} 条数据与第 ${keyMap.get(key)} 条数据重复：主键 [${key}] 已存在`);
      } else {
        keyMap.set(key, rowNum);
      }
    });

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingKeys = await SELECT.from(Transfer)
      .columns(['TransferOrder', 'TransferOrderItem'])
      .where({
        TransferOrder: { in: data.map(p => p.TransferOrder) }
      });

    existingKeys.forEach(existing => {
      const key = `${existing.TransferOrder}-${existing.TransferOrderItem}`;
      if (keyMap.has(key)) {
        req.error(409, `主键 [${key}] 已在数据库中存在，无法重复创建`);
      }
    });

    // --------------------------
    // 如果有任何错误，直接回滚并返回
    // --------------------------
    if (req.errors) {
      return req.reject(); // 自动回滚事务，返回所有错误
    }

    // --------------------------
    // 校验通过，执行批量插入
    // --------------------------
    await INSERT.into(Transfer).entries(data);

    // --------------------------
    // 调用 MultiStepInvoker 处理多步流程
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 只调用一次 MultiStepInvoker，处理整个批处理
    let invokerResult = null;
    if (data.length > 0) {
      invokerResult = await invoker.process('Transfer', data);
    }

    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    const result = {
      code: invokerResult.code === 'S' ? 200 : 400,
      message: invokerResult.message ? invokerResult.message.substring(0, 500) : '推送成功'
    };
    
    // 只有同步模式且 objkey 有值时才添加 objkey 字段
    if (invokerResult.objkey) {
      result.objkey = invokerResult.objkey;
    }
    
    return result;
  });
  //收付款单
  this.on('PrCreate', async (req) => {
    const { data } = req.data;
    if (!data || data.length === 0) req.error(400, "数据不能为空");

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.paymentReceiptNo) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：paymentReceiptNo`);
      }
      if (!item.paymentReceiptNoItem) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：paymentReceiptNoItem`);
      }
    });

    // --------------------------
    // 批量内重复主键校验
    // --------------------------
    const keyMap = new Map();
    data.forEach((item, index) => {
      const rowNum = index + 1;
      const key = `${item.paymentReceiptNo}-${item.paymentReceiptNoItem}`;
      if (keyMap.has(key)) {
        req.error(400, `第 ${rowNum} 条数据与第 ${keyMap.get(key)} 条数据重复：主键 [${key}] 已存在`);
      } else {
        keyMap.set(key, rowNum);
      }
    });

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingKeys = await SELECT.from(PaymentReceipt)
      .columns(['paymentReceiptNo', 'paymentReceiptNoItem'])
      .where({
        paymentReceiptNo: { in: data.map(p => p.paymentReceiptNo) }
      });

    existingKeys.forEach(existing => {
      const key = `${existing.paymentReceiptNo}-${existing.paymentReceiptNoItem}`;
      if (keyMap.has(key)) {
        req.error(409, `主键 [${key}] 已在数据库中存在，无法重复创建`);
      }
    });

    // --------------------------
    // 如果有任何错误，直接回滚并返回
    // --------------------------
    if (req.errors) {
      return req.reject(); // 自动回滚事务，返回所有错误
    }

    // --------------------------
    // 校验通过，执行批量插入
    // --------------------------
    await INSERT.into(PaymentReceipt).entries(data);

    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    return {
      code: 200,
      message: "推送成功",
    };
  });
  //销售出库
    this.on('OdCreate', async (req) => {
    const { data } = req.data;
    if (!data || data.length === 0) req.error(400, "数据不能为空");

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.SalesOrder) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：SalesOrder`);
      }
      if (!item.SalesOrderItem) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：SalesOrderItem`);
      }
    });

    // --------------------------
    // 批量内重复主键校验
    // --------------------------
    const keyMap = new Map();
    data.forEach((item, index) => {
      const rowNum = index + 1;
      const key = `${item.SalesOrder}-${item.SalesOrderItem}`;
      if (keyMap.has(key)) {
        req.error(400, `第 ${rowNum} 条数据与第 ${keyMap.get(key)} 条数据重复：主键 [${key}] 已存在`);
      } else {
        keyMap.set(key, rowNum);
      }
    });

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingKeys = await SELECT.from(OutboundDelivery)
      .columns(['SalesOrder', 'SalesOrderItem'])
      .where({
        SalesOrder: { in: data.map(p => p.SalesOrder) }
      });

    existingKeys.forEach(existing => {
      const key = `${existing.SalesOrder}-${existing.SalesOrderItem}`;
      if (keyMap.has(key)) {
        req.error(409, `主键 [${key}] 已在数据库中存在，无法重复创建`);
      }
    });

    // --------------------------
    // 如果有任何错误，直接回滚并返回
    // --------------------------
    if (req.errors) {
      return req.reject(); // 自动回滚事务，返回所有错误
    }

    // --------------------------
    // 校验通过，执行批量插入
    // --------------------------
    await INSERT.into(OutboundDelivery).entries(data);

    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    return {
      code: 200,
      message: "推送成功",
    };
  });
});