module.exports = cds.service.impl(async function () {
  const { Transfer, PaymentReceipt, OutboundDelivery, MPTTypeConfig } = this.entities;
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
    const existingKeys = await cds.run(SELECT.from(Transfer)
      .columns(['TransferOrder', 'TransferOrderItem'])
      .where({
        TransferOrder: { in: data.map(p => p.TransferOrder) }
      }));

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
    // 检查数据是否为空
    // --------------------------
    if (!data || data.length === 0) {
      req.error(400, '传入的数据为空');
      return req.reject();
    }

    // --------------------------
    // 调用 MultiStepInvoker 处理多步流程
    // zrfc_logid 和 zrfcid 的生成以及业务表的插入由 MultiStepInvoker 负责
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 调用 MultiStepInvoker，传入业务流程ID和三个业务表的数据
    const invokerResult = await invoker.process('MM01', data, null, null);

    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    const result = {};
    if (invokerResult) {
      result.code = invokerResult.code === 'S' ? 200 : 400;
      result.message = invokerResult.message ? invokerResult.message.substring(0, 500) : '处理成功';
      result.zrfc_logid = invokerResult.zrfcLogid;
      result.zrfcid = invokerResult.zrfcid;
      if (invokerResult.objkey) {
        result.objkey = invokerResult.objkey;
      }
    } else {
      result.code = 200;
      result.message = '没有数据需要处理';
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
    const existingKeys = await cds.run(SELECT.from(PaymentReceipt)
      .columns(['paymentReceiptNo', 'paymentReceiptNoItem'])
      .where({
        paymentReceiptNo: { in: data.map(p => p.paymentReceiptNo) }
      }));

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
    // 调用 MultiStepInvoker 处理多步流程
    // zrfc_logid 和 zrfcid 的生成以及业务表的插入由 MultiStepInvoker 负责
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 调用 MultiStepInvoker，传入业务流程ID和三个业务表的数据
    const invokerResult = await invoker.process('FI01', data, null, null);

    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    const result = {};
    if (invokerResult) {
      result.code = invokerResult.code === 'S' ? 200 : 400;
      result.message = invokerResult.message ? invokerResult.message.substring(0, 500) : '处理成功';
      result.zrfc_logid = invokerResult.zrfcLogid;
      result.zrfcid = invokerResult.zrfcid;
      if (invokerResult.objkey) {
        result.objkey = invokerResult.objkey;
      }
    } else {
      result.code = 200;
      result.message = '没有数据需要处理';
    }
    
    return result;
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
      if (!item.SalesOrganization) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：SalesOrganization`);
      }
      if (!item.ReceivingPlant) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：ReceivingPlant`);
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
    const existingKeys = await cds.run(SELECT.from(OutboundDelivery)
      .columns(['SalesOrder', 'SalesOrderItem'])
      .where({
        SalesOrder: { in: data.map(p => p.SalesOrder) }
      }));

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
    // 根据 SalesOrganization 和 ReceivingPlant 查询 MPTTypeConfig
    // SalesOrganization = zxsf（销售方）, ReceivingPlant = zfcf（发出方）
    // --------------------------
    const firstData = data[0];
    const mptConfig = await cds.run(SELECT.one(MPTTypeConfig)
      .columns(['zrfcid', 'zdfjy'])
      .where({
        zxsf: firstData.SalesOrganization,
        zfcf: firstData.ReceivingPlant
      }));

    if (!mptConfig) {
      req.error(400, `未找到多方交易类型配置：SalesOrganization=${firstData.SalesOrganization}, ReceivingPlant=${firstData.ReceivingPlant}`);
      return req.reject();
    }

    // --------------------------
    // 调用 MultiStepInvoker 处理多步流程
    // 传入查询到的 zrfcid 和 zdfjy
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 调用 MultiStepInvoker，传入业务流程ID、数据和 zdfjy
    const invokerResult = await invoker.process(mptConfig.zrfcid, data, null, null, mptConfig.zdfjy);

    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    const result = {};
    if (invokerResult) {
      result.code = invokerResult.code === 'S' ? 200 : 400;
      result.message = invokerResult.message ? invokerResult.message.substring(0, 500) : '处理成功';
      result.zrfc_logid = invokerResult.zrfcLogid;
      result.zrfcid = invokerResult.zrfcid;
      if (invokerResult.objkey) {
        result.objkey = invokerResult.objkey;
      }
    } else {
      result.code = 200;
      result.message = '没有数据需要处理';
    }
    
    return result;
  });
});