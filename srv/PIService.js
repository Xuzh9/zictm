module.exports = cds.service.impl(async function () {
  const { SalesOrderCreate, SalesOrderChange, MPTTypeConfig } = this.entities;
  
  // --------------------------
  // 根据 YY1_FD_ZDFJY 获取 zrfcid 和 zdfjy
  // --------------------------
  async function getZrfcidByZdfjy(req, YY1_FD_ZDFJY) {
    const { SELECT } = cds.ql;
    // 在嵌套函数内部重新获取实体
    const MPTTypeConfig = cds.entities['com.sap.zictm.MPTTypeConfig'];
    
    if (!YY1_FD_ZDFJY) {
      req.error(400, 'YY1_FD_ZDFJY 不能为空');
      return null;
    }
    
    const config = await cds.run(SELECT.one(MPTTypeConfig)
      .columns(['zrfcid', 'zdfjy'])
      .where({ zdfjy: YY1_FD_ZDFJY }));
    
    if (!config) {
      req.error(400, `未找到多方交易类型配置：${YY1_FD_ZDFJY}`);
      return null;
    }
    
    return config;
  }
  
  //创建
  this.on('SOCreate', async (req) => {
    console.log('[SOCreate] 开始处理请求');
    const { data } = req.data;
    console.log('[SOCreate] 请求数据:', JSON.stringify(data));
    if (!data || data.length === 0) req.error(400, "数据不能为空");

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.PIOrder) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：PIOrder`);
      }
      if (!item.PIOrderItem) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：PIOrderItem`);
      }
      if (!item.YY1_FD_ZDFJY) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：YY1_FD_ZDFJY`);
      }
      if (!item.SalesOrderType) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：SalesOrderType`);
      }
      if (!item.SalesOrganization) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：SalesOrganization`);
      }
      if (!item.DistributionChannel) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：DistributionChannel`);
      }
      if (!item.OrganizationDivision) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：OrganizationDivision`);
      }
      if (!item.SalesDistrict) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：SalesDistrict`);
      }
      if (!item.TransactionCurrency) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：TransactionCurrency`);
      }
      if (!item.RequestedDeliveryDate) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：RequestedDeliveryDate`);
      }
      if (!item.Material) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：Material`);
      }
      if (!item.RequestedQuantity) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：RequestedQuantity`);
      }
      if (!item.ConfirmedDeliveryDate) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：ConfirmedDeliveryDate`);
      }
      if (!item.ScheduleLineOrderQuantity) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：ScheduleLineOrderQuantity`);
      }
    });

    // --------------------------
    // 批量内重复主键校验
    // --------------------------
    const keyMap = new Map();
    data.forEach((item, index) => {
      const rowNum = index + 1;
      const key = `${item.PIOrder}-${item.PIOrderItem}`;
      if (keyMap.has(key)) {
        req.error(400, `第 ${rowNum} 条数据与第 ${keyMap.get(key)} 条数据重复：主键 [${key}] 已存在`);
      } else {
        keyMap.set(key, rowNum);
      }
    });

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingKeys = await cds.run(SELECT.from(SalesOrderCreate)
      .columns(['PIOrder', 'PIOrderItem'])
      .where({
        PIOrder: { in: data.map(p => p.PIOrder) }
      }));
    
    existingKeys.forEach(existing => {
      const key = `${existing.PIOrder}-${existing.PIOrderItem}`;
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
    // 根据 YY1_FD_ZDFJY 获取 zrfcid 和 zdfjy
    // --------------------------
    const mptConfig = await getZrfcidByZdfjy(req, data[0].YY1_FD_ZDFJY);
    
    // 如果有错误，直接回滚并返回
    if (req.errors || !mptConfig) {
      return req.reject();
    }

    // --------------------------
    // 调用 MultiStepInvoker 处理多步流程
    // zrfc_logid 和 zrfcid 的生成以及业务表的插入由 MultiStepInvoker 负责
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 调用 MultiStepInvoker，传入查询到的业务流程ID和 zdfjy
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
  
  //修改
  this.on('SOChange', async (req) => {
    const { data } = req.data;
    if (!data || data.length === 0) req.error(400, "数据不能为空");

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.PIOrder) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：PIOrder`);
      }
      if (!item.PIOrderItem) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：PIOrderItem`);
      }
    });

    // --------------------------
    // 批量内重复主键校验
    // --------------------------
    const keyMap = new Map();
    data.forEach((item, index) => {
      const rowNum = index + 1;
      const key = `${item.PIOrder}-${item.PIOrderItem}`;
      if (keyMap.has(key)) {
        req.error(400, `第 ${rowNum} 条数据与第 ${keyMap.get(key)} 条数据重复：主键 [${key}] 已存在`);
      } else {
        keyMap.set(key, rowNum);
      }
    });

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingKeys = await cds.run(SELECT.from(SalesOrderChange)
      .columns(['PIOrder', 'PIOrderItem'])
      .where({
        PIOrder: { in: data.map(p => p.PIOrder) }
      }));

    existingKeys.forEach(existing => {
      const key = `${existing.PIOrder}-${existing.PIOrderItem}`;
      if (keyMap.has(key)) {
        req.error(409, `主键 [${key}] 已在数据库中存在，无法重复创建`);
      }
    });

    // --------------------------
    // 校验 PIOrder 和 PIOrderItem 必须在 SalesOrderCreate 表中存在
    // --------------------------
    const SalesOrderCreate = cds.entities['com.sap.zictm.SalesOrderCreate'];
    const createKeys = await cds.run(SELECT.from(SalesOrderCreate)
      .columns(['PIOrder', 'PIOrderItem'])
      .where({
        PIOrder: { in: data.map(p => p.PIOrder) }
      }));

    const createKeySet = new Set(createKeys.map(k => `${k.PIOrder}-${k.PIOrderItem}`));

    data.forEach((item, index) => {
      const rowNum = index + 1;
      const key = `${item.PIOrder}-${item.PIOrderItem}`;
      if (!createKeySet.has(key)) {
        req.error(404, `第 ${rowNum} 条数据的 PIOrder 和 PIOrderItem 组合 [${key}] 尚未创建过，不允许修改`);
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
    
    // 调用 MultiStepInvoker
    const invokerResult = await invoker.process('SD03', data, null, null, null);
    
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