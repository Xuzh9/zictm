const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const service = this;
  const { SELECT } = cds.ql;
  const { SalesOrderCreate, SalesOrderChange, PISalesOrderRel } = this.entities;

  // 获取 MultistepLog 实体引用
  const MultistepLog = cds.entities['com.sap.zictm.MultistepLog'];

  // 读取 PISalesOrderRel 时，计算 code 和 message
  this.on('READ', 'PISalesOrderRel', async (req) => {
    console.log('[PISalesOrderRel] READ 请求');

    // 使用 req.query 来保留 OData 查询参数（$filter, $select, $top 等）
    let results = await cds.run(req.query);

    // 如果没有数据，直接返回
    if (!results || results.length === 0) {
      return results;
    }

    // 如果是单条记录，转成数组
    if (!Array.isArray(results)) {
      results = [results];
    }

    // 收集所有 zrfc_logid
    const zrfcLogids = [...new Set(results.map(r => r.zrfc_logid).filter(Boolean))];

    if (zrfcLogids.length === 0) {
      // 没有 zrfc_logid，设置默认值
      results.forEach(r => {
        r.code = 'S';
        r.message = '无关联日志';
      });
      return results;
    }

    // 批量查询 MultistepLog，获取所有失败步骤
    const failedSteps = await cds.run(
      SELECT.from(MultistepLog).columns([
        'zrfc_logid', 'canum', 'code', 'message'
      ]).where({
        zrfc_logid: { in: zrfcLogids },
        code: 'E'
      })
    );

    // 按 zrfc_logid 分组失败步骤
    const failedStepsByLogId = new Map();
    for (const step of failedSteps) {
      if (!failedStepsByLogId.has(step.zrfc_logid)) {
        failedStepsByLogId.set(step.zrfc_logid, []);
      }
      failedStepsByLogId.get(step.zrfc_logid).push(step);
    }

    // 计算每个 PISalesOrderRel 的 code 和 message
    results.forEach(r => {
      const logFailedSteps = failedStepsByLogId.get(r.zrfc_logid) || [];

      if (logFailedSteps.length > 0) {
        // 有失败步骤，按 canum 排序取最小
        logFailedSteps.sort((a, b) => parseInt(a.canum) - parseInt(b.canum));
        r.code = 'E';
        r.message = logFailedSteps[0].message;
      } else {
        // 没有失败步骤
        r.code = 'S';
        r.message = '执行成功';
      }
    });

    console.log('[PISalesOrderRel] READ 完成，返回', results.length, '条记录');
    
    // 如果原始查询是单条查询，返回单条记录
    if (req.query.SELECT && req.query.SELECT.one) {
      return results[0];
    }
    return results;
  });
  
  // --------------------------
  // 根据 YY1_FD_ZDFJY 获取 zrfcid 和 zdfjy
  // --------------------------
  async function getZrfcidByZdfjy(req, YY1_FD_ZDFJY) {
    const { SELECT } = cds.ql;
    // 使用完整的实体路径获取 MPTTypeConfig
    const MPTTypeConfig = cds.entities['com.sap.zictm.MPTTypeConfig'];
    
    if (!YY1_FD_ZDFJY) {
      req.error(400, 'YY1_FD_ZDFJY 不能为空');
      return null;
    }
    
    // 使用 cds.run() 来查询不在当前服务中的实体
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
    const ApiInputLogHelper = require('./handlers/ApiInputLogHelper');
    
    // --------------------------
    // 检查数据格式是否正确（必须是数组）
    // --------------------------
    if (!data || !Array.isArray(data)) {
      const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据格式错误：data 必须是数组');
      return {
        code: 400,
        message: '数据格式错误：data 必须是数组',
        id: logId
      };
    }
    
    // --------------------------
    // 检查数据是否为空
    // --------------------------
    if (data.length === 0) {
      const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据不能为空');
      return {
        code: 400,
        message: '数据不能为空',
        id: logId
      };
    }

    // --------------------------
    // 错误收集数组
    // --------------------------
    const errors = [];

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.PIOrder) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：PIOrder`);
      }
      if (!item.PIOrderItem) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：PIOrderItem`);
      }
      if (!item.YY1_FD_ZDFJY) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：YY1_FD_ZDFJY`);
      }
      if (!item.SalesOrderType) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：SalesOrderType`);
      }
      if (!item.SalesOrganization) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：SalesOrganization`);
      }
      if (!item.DistributionChannel) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：DistributionChannel`);
      }
      if (!item.OrganizationDivision) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：OrganizationDivision`);
      }
      if (!item.SalesDistrict) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：SalesDistrict`);
      }
      if (!item.TransactionCurrency) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：TransactionCurrency`);
      }
      if (!item.RequestedDeliveryDate) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：RequestedDeliveryDate`);
      }
      if (!item.Material) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：Material`);
      }
      if (!item.RequestedQuantity) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：RequestedQuantity`);
      }
      if (!item.ProductionPlant) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：ProductionPlant`);
      }
      if (!item.ConfirmedDeliveryDate) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：ConfirmedDeliveryDate`);
      }
      if (!item.ScheduleLineOrderQuantity) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：ScheduleLineOrderQuantity`);
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
        errors.push(`第 ${rowNum} 条数据与第 ${keyMap.get(key)} 条数据重复：主键 [${key}] 已存在`);
      } else {
        keyMap.set(key, rowNum);
      }
    });

    // --------------------------
    // 检查必填字段校验结果（在执行数据库查询之前）
    // --------------------------
    if (errors.length > 0) {
      const errorMessages = errors.join('; ');
      const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: logId
      };
    }

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingKeys = await service.run(SELECT.from(SalesOrderCreate)
      .columns(['PIOrder', 'PIOrderItem'])
      .where({
        PIOrder: { in: data.map(p => p.PIOrder) }
      }));
    
    existingKeys.forEach(existing => {
      const key = `${existing.PIOrder}-${existing.PIOrderItem}`;
      if (keyMap.has(key)) {
        errors.push(`主键 [${key}] 已在数据库中存在，无法重复创建`);
      }
    });

    // --------------------------
    // 根据 YY1_FD_ZDFJY 获取 zrfcid 和 zdfjy
    // --------------------------
    const mptConfig = await getZrfcidByZdfjy(req, data[0].YY1_FD_ZDFJY);
    
    if (!mptConfig) {
      errors.push('未找到多方交易类型配置');
    }
    
    // --------------------------
    // 如果有任何错误，保存错误日志并返回（不调用 MultiStepInvoker）
    // --------------------------
    if (errors.length > 0) {
      const errorMessages = errors.join('; ');
      const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: logId
      };
    }

    // --------------------------
    // 保存 ApiInputLog（在调用 MultiStepInvoker 之前）
    // --------------------------
    const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, null);
    
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
      result.id = logId;
      if (invokerResult.objkey) {
        result.objkey = invokerResult.objkey;
      }
    } else {
      result.code = 200;
      result.message = '没有数据需要处理';
      result.id = logId;
    }
    
    return result;
  });
  
  //修改
  this.on('SOChange', async (req) => {
    const { data } = req.data;
    const ApiInputLogHelper = require('./handlers/ApiInputLogHelper');
    
    // --------------------------
    // 检查数据格式是否正确（必须是数组）
    // --------------------------
    if (!data || !Array.isArray(data)) {
      const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据格式错误：data 必须是数组');
      return {
        code: 400,
        message: '数据格式错误：data 必须是数组',
        id: logId
      };
    }
    
    // --------------------------
    // 检查数据是否为空
    // --------------------------
    if (data.length === 0) {
      const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据不能为空');
      return {
        code: 400,
        message: '数据不能为空',
        id: logId
      };
    }

    // --------------------------
    // 错误收集数组
    // --------------------------
    const errors = [];

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.PIOrder) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：PIOrder`);
      }
      if (!item.PIOrderItem) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：PIOrderItem`);
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
        errors.push(`第 ${rowNum} 条数据与第 ${keyMap.get(key)} 条数据重复：主键 [${key}] 已存在`);
      } else {
        keyMap.set(key, rowNum);
      }
    });

    // --------------------------
    // 检查必填字段校验结果（在执行数据库查询之前）
    // --------------------------
    if (errors.length > 0) {
      const errorMessages = errors.join('; ');
      const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: logId
      };
    }

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingKeys = await service.run(SELECT.from(SalesOrderChange)
      .columns(['PIOrder', 'PIOrderItem'])
      .where({
        PIOrder: { in: data.map(p => p.PIOrder) }
      }));

    existingKeys.forEach(existing => {
      const key = `${existing.PIOrder}-${existing.PIOrderItem}`;
      if (keyMap.has(key)) {
        errors.push(`主键 [${key}] 已在数据库中存在，无法重复创建`);
      }
    });

    // --------------------------
    // 校验 PIOrder 和 PIOrderItem 必须在 SalesOrderCreate 表中存在
    // --------------------------
    const SalesOrderCreate = cds.entities['com.sap.zictm.SalesOrderCreate'];
    const createKeys = await service.run(SELECT.from(SalesOrderCreate)
      .columns(['PIOrder', 'PIOrderItem'])
      .where({
        PIOrder: { in: data.map(p => p.PIOrder) }
      }));

    const createKeySet = new Set(createKeys.map(k => `${k.PIOrder}-${k.PIOrderItem}`));

    data.forEach((item, index) => {
      const rowNum = index + 1;
      const key = `${item.PIOrder}-${item.PIOrderItem}`;
      if (!createKeySet.has(key)) {
        errors.push(`第 ${rowNum} 条数据的 PIOrder 和 PIOrderItem 组合 [${key}] 尚未创建过，不允许修改`);
      }
    });
    
    // --------------------------
    // 如果有任何错误，保存错误日志并返回（不调用 MultiStepInvoker）
    // --------------------------
    if (errors.length > 0) {
      const errorMessages = errors.join('; ');
      const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: logId
      };
    }

    // --------------------------
    // 保存 ApiInputLog（在调用 MultiStepInvoker 之前）
    // --------------------------
    const logId = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, null);
    
    // --------------------------
    // 调用 MultiStepInvoker 处理多步流程
    // zrfc_logid 和 zrfcid 的生成以及业务表的插入由 MultiStepInvoker 负责
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 调用 MultiStepInvoker，传入 SD03 作为固定的业务流程ID
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
      result.id = logId;
      if (invokerResult.objkey) {
        result.objkey = invokerResult.objkey;
      }
    } else {
      result.code = 200;
      result.message = '没有数据需要处理';
      result.id = logId;
    }
    
    return result;
  });
});