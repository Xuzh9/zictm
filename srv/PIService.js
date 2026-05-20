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

    // 如果没有数据，尝试从业务表获取
    if (!results || results.length === 0) {
      const filterResult = await this.handleEmptyResults(req);
      if (filterResult) {
        return filterResult;
      }
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

    // 批量查询 MultistepHeadLog，获取执行状态
    const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
    const headLogs = await cds.run(
      SELECT.from(MultistepHeadLog).columns([
        'zrfc_logid', 'code', 'message'
      ]).where({
        zrfc_logid: { in: zrfcLogids }
      })
    );

    // 按 zrfc_logid 映射
    const headLogsByLogId = new Map();
    for (const log of headLogs) {
      headLogsByLogId.set(log.zrfc_logid, { code: log.code, message: log.message });
    }

    // 计算每个 PISalesOrderRel 的 code 和 message
    results.forEach(r => {
      const headLog = headLogsByLogId.get(r.zrfc_logid);
      if (headLog) {
        r.code = headLog.code;
        r.message = headLog.message || '执行成功';
      } else {
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

  // 处理 PISalesOrderRel 表没有数据的情况
  this.handleEmptyResults = async function(req) {
    console.log('[PISalesOrderRel] PISalesOrderRel 表没有数据，尝试从业务表获取');
    console.log('[PISalesOrderRel] req.query.SELECT:', JSON.stringify(req.query.SELECT, null, 2));

    // 解析 $filter 参数
    let filterPIOrder = null;
    let filterPIOrderItem = null;

    if (req.query.SELECT && req.query.SELECT.where) {
      const whereClause = req.query.SELECT.where;
      console.log('[PISalesOrderRel] whereClause:', JSON.stringify(whereClause, null, 2));

      // 递归解析 where 子句
      function parseWhereClause(clause) {
        if (!Array.isArray(clause)) {
          return;
        }

        if (clause.length >= 3) {
          let [ref, op, val] = clause;
          console.log('[PISalesOrderRel] 解析条件:', JSON.stringify(ref), op, JSON.stringify(val));

          // 处理 ref 是对象的情况 { "ref": ["PIOrder"] }
          let fieldName = null;
          if (ref && typeof ref === 'string') {
            fieldName = ref;
          } else if (ref && ref.ref && Array.isArray(ref.ref)) {
            fieldName = ref.ref[0];
          }

          // 处理 val 是对象的情况 { "val": "175643875" }
          let fieldValue = val;
          if (val && val.val !== undefined) {
            fieldValue = val.val;
          }

          if (fieldName === 'PIOrder') {
            filterPIOrder = fieldValue;
            console.log('[PISalesOrderRel] 找到 PIOrder:', fieldValue);
          } else if (fieldName === 'PIOrderItem') {
            filterPIOrderItem = fieldValue;
            console.log('[PISalesOrderRel] 找到 PIOrderItem:', fieldValue);
          }
        }

        // 递归处理子句中的其他元素
        for (const item of clause) {
          if (Array.isArray(item)) {
            parseWhereClause(item);
          }
        }
      }

      parseWhereClause(whereClause);
    }

    console.log('[PISalesOrderRel] 解析结果 - PIOrder:', filterPIOrder, 'PIOrderItem:', filterPIOrderItem);

    if (!filterPIOrder && !filterPIOrderItem) {
      console.log('[PISalesOrderRel] 缺少 PIOrder 或 PIOrderItem 过滤条件');
      return null;
    }

    // 构建查询条件
    const whereCondition = {};
    if (filterPIOrder) {
      whereCondition.PIOrder = filterPIOrder;
    }
    if (filterPIOrderItem) {
      whereCondition.PIOrderItem = filterPIOrderItem;
    }

    console.log('[PISalesOrderRel] 查询条件:', JSON.stringify(whereCondition));

    // 尝试从 SalesOrderCreate 表获取数据
    let businessDataList = await cds.run(
      SELECT.from(SalesOrderCreate)
        .columns(['PIOrder', 'PIOrderItem', 'zrfc_logid'])
        .where(whereCondition)
    );

    console.log('[PISalesOrderRel] SalesOrderCreate 查询结果:', businessDataList);

    // 如果 SalesOrderCreate 没有，尝试 SalesOrderChange
    if (!businessDataList || businessDataList.length === 0) {
      businessDataList = await cds.run(
        SELECT.from(SalesOrderChange)
          .columns(['PIOrder', 'PIOrderItem', 'zrfc_logid'])
          .where(whereCondition)
      );
      console.log('[PISalesOrderRel] SalesOrderChange 查询结果:', businessDataList);
    }
    if (!businessDataList || businessDataList.length === 0) {
      console.log('[PISalesOrderRel] 业务表中也没有找到对应数据');
      return null;
    }

    // 获取第一个业务数据的 zrfc_logid（同一 PIOrder 的所有行应该有相同的 zrfc_logid）
    const firstBusinessData = businessDataList[0];
    console.log('[PISalesOrderRel] 找到业务数据，zrfc_logid:', firstBusinessData.zrfc_logid);

    // 查询 MultistepHeadLog 获取执行状态
    const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
    const headLog = await cds.run(
      SELECT.one(MultistepHeadLog)
        .columns(['code', 'message'])
        .where({
          zrfc_logid: firstBusinessData.zrfc_logid
        })
    );

    let code = 'S';
    let message = '执行成功';

    if (headLog) {
      code = headLog.code;
      message = headLog.message || '执行成功';
    }

    // 如果指定了 PIOrderItem，只返回匹配的那一行
    if (filterPIOrderItem) {
      const matchedItem = businessDataList.find(item => item.PIOrderItem === filterPIOrderItem);
      if (matchedItem) {
        const result = {
          PIOrder: filterPIOrder || matchedItem.PIOrder,
          PIOrderItem: matchedItem.PIOrderItem,
          code: code,
          message: message
        };
        console.log('[PISalesOrderRel] 返回结果:', JSON.stringify(result));
        return result;
      }
      return null;
    }

    // 返回所有匹配的行
    const results = businessDataList.map(item => ({
      PIOrder: filterPIOrder || item.PIOrder,
      PIOrderItem: item.PIOrderItem,
      code: code,
      message: message
    }));

    console.log('[PISalesOrderRel] 返回结果:', JSON.stringify(results));
    return results;
  };
  
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
    const ApiInputLogHelper = require('./handlers/ApiInputLogHelper');
    
    // --------------------------
    // 检查数据格式是否正确（必须是数组）
    // --------------------------
    if (!data || !Array.isArray(data)) {
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据格式错误：data 必须是数组');
      return {
        code: 400,
        message: '数据格式错误：data 必须是数组',
        id: id
      };
    }
    
    // --------------------------
    // 检查数据是否为空
    // --------------------------
    if (data.length === 0) {
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据不能为空');
      return {
        code: 400,
        message: '数据不能为空',
        id: id
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
      if (!item.SalesOffice) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：SalesOffice`);
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
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: id
      };
    }

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingRecords = await service.run(SELECT.from(SalesOrderCreate)
      .columns(['PIOrder', 'PIOrderItem', 'zrfc_logid'])
      .where({
        PIOrder: { in: data.map(p => p.PIOrder) }
      }));
    
    // 获取需要查询的 zrfc_logid 列表
    const zrfcLogids = existingRecords
      .filter(r => r.zrfc_logid)
      .map(r => r.zrfc_logid);
    
    // 查询 MultistepHeadLog 获取执行状态
    const headLogs = {};
    if (zrfcLogids.length > 0) {
      const logs = await service.run(SELECT.from('MultistepHeadLog')
        .columns(['zrfc_logid', 'code'])
        .where({ zrfc_logid: { in: zrfcLogids } }));
      logs.forEach(log => {
        headLogs[log.zrfc_logid] = log.code;
      });
    }
    
    existingRecords.forEach(existing => {
      const key = `${existing.PIOrder}-${existing.PIOrderItem}`;
      if (keyMap.has(key)) {
        const headLogCode = headLogs[existing.zrfc_logid];
        if (headLogCode === 'S') {
          errors.push(`主键 [${key}] 已成功推送，无法重复推送`);
        }
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
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: id
      };
    }

    // --------------------------
    // 保存 ApiInputLog（在调用 MultiStepInvoker 之前）
    // --------------------------
    const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, null);
    
    // --------------------------
    // 调用 MultiStepInvoker 处理多步流程
    // zrfc_logid 和 zrfcid 的生成以及业务表的插入由 MultiStepInvoker 负责
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 调用 MultiStepInvoker，传入查询到的业务流程ID、zdfjy 和 id
    const invokerResult = await invoker.process(mptConfig.zrfcid, data, null, null, mptConfig.zdfjy, id);
    
    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    const result = {};
    if (invokerResult) {
      result.code = invokerResult.code === 'S' ? 200 : 400;
      result.message = invokerResult.message ? invokerResult.message.substring(0, 500) : '处理成功';
      result.zrfc_logid = invokerResult.zrfcLogid;
      result.zrfcid = invokerResult.zrfcid;
      result.id = id;
      if (invokerResult.objkey) {
        result.objkey = invokerResult.objkey;
      }
    } else {
      result.code = 200;
      result.message = '没有数据需要处理';
      result.id = id;
    }
    
    return result;
  });
  
  //转移
  this.on('Transfer', async (req) => {
    console.log('[Transfer] 开始处理请求');
    const { data } = req.data;
    const ApiInputLogHelper = require('./handlers/ApiInputLogHelper');
    
    // --------------------------
    // 检查数据格式是否正确（必须是数组）
    // --------------------------
    if (!data || !Array.isArray(data)) {
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据格式错误：data 必须是数组');
      return {
        code: 400,
        message: '数据格式错误：data 必须是数组',
        id: id
      };
    }
    
    // --------------------------
    // 检查数据是否为空
    // --------------------------
    if (data.length === 0) {
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据不能为空');
      return {
        code: 400,
        message: '数据不能为空',
        id: id
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
      if (!item.Material) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：Material`);
      }
      if (!item.Plant) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：Plant`);
      }
      if (!item.StorageLocation) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：StorageLocation`);
      }
      if (!item.IssuingOrReceivingStorageLoc) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：IssuingOrReceivingStorageLoc`);
      }
      if (!item.GoodsMovementCode) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：GoodsMovementCodee`);
      }
      if (!item.GoodsMovementType) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：GoodsMovementType`);
      }
      if (!item.QuantityInBaseUnit && item.QuantityInBaseUnit !== 0) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：QuantityInBaseUnit`);
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
    // 如果有任何错误，保存错误日志并返回
    // --------------------------
    if (errors.length > 0) {
      const errorMessages = errors.join('; ');
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: id
      };
    }

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingRecords = await service.run(SELECT.from(PISalesOrderRel)
      .columns(['PIOrder', 'PIOrderItem', 'zrfc_logid'])
      .where({
        PIOrder: { in: data.map(p => p.PIOrder) }
      }));
    
    // 获取需要查询的 zrfc_logid 列表
    const zrfcLogids = existingRecords
      .filter(r => r.zrfc_logid)
      .map(r => r.zrfc_logid);
    
    // 查询 MultistepHeadLog 获取执行状态
    const headLogs = {};
    if (zrfcLogids.length > 0) {
      const logs = await service.run(SELECT.from('MultistepHeadLog')
        .columns(['zrfc_logid', 'code'])
        .where({ zrfc_logid: { in: zrfcLogids } }));
      logs.forEach(log => {
        headLogs[log.zrfc_logid] = log.code;
      });
    }
    
    existingRecords.forEach(existing => {
      const key = `${existing.PIOrder}-${existing.PIOrderItem}`;
      if (keyMap.has(key)) {
        const headLogCode = headLogs[existing.zrfc_logid];
        if (headLogCode === 'S') {
          errors.push(`主键 [${key}] 已成功推送，无法重复推送`);
        }
      }
    });

    // --------------------------
    // 如果有任何错误，保存错误日志并返回（不调用 MultiStepInvoker）
    // --------------------------
    if (errors.length > 0) {
      const errorMessages = errors.join('; ');
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: id
      };
    }

    // --------------------------
    // 保存 ApiInputLog（在调用 MultiStepInvoker 之前）
    // --------------------------
    const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, null);
    
    // --------------------------
    // 调用 MultiStepInvoker 处理多步流程
    // zrfc_logid 和 zrfcid 的生成以及业务表的插入由 MultiStepInvoker 负责
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 调用 MultiStepInvoker，传入业务流程ID和业务表数据
    const invokerResult = await invoker.process('MM02', data, null, null, null, id);

    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    const result = {};
    if (invokerResult) {
      result.code = invokerResult.code === 'S' ? 200 : 400;
      result.message = invokerResult.message ? invokerResult.message.substring(0, 500) : '处理成功';
      result.zrfc_logid = invokerResult.zrfcLogid;
      result.zrfcid = invokerResult.zrfcid;
      result.id = id;
      if (invokerResult.objkey) {
        result.objkey = invokerResult.objkey;
      }
    } else {
      result.code = 200;
      result.message = '没有数据需要处理';
      result.id = id;
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
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据格式错误：data 必须是数组');
      return {
        code: 400,
        message: '数据格式错误：data 必须是数组',
        id: id
      };
    }
    
    // --------------------------
    // 检查数据是否为空
    // --------------------------
    if (data.length === 0) {
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '数据不能为空');
      return {
        code: 400,
        message: '数据不能为空',
        id: id
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
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: id
      };
    }

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingRecords = await service.run(SELECT.from(SalesOrderChange)
      .columns(['PIOrder', 'PIOrderItem', 'zrfc_logid'])
      .where({
        PIOrder: { in: data.map(p => p.PIOrder) }
      }));
    
    // 获取需要查询的 zrfc_logid 列表
    const zrfcLogids = existingRecords
      .filter(r => r.zrfc_logid)
      .map(r => r.zrfc_logid);
    
    // 查询 MultistepHeadLog 获取执行状态
    const headLogs = {};
    if (zrfcLogids.length > 0) {
      const logs = await service.run(SELECT.from('MultistepHeadLog')
        .columns(['zrfc_logid', 'code'])
        .where({ zrfc_logid: { in: zrfcLogids } }));
      logs.forEach(log => {
        headLogs[log.zrfc_logid] = log.code;
      });
    }
    
    existingRecords.forEach(existing => {
      const key = `${existing.PIOrder}-${existing.PIOrderItem}`;
      if (keyMap.has(key)) {
        const headLogCode = headLogs[existing.zrfc_logid];
        if (headLogCode === 'S') {
          errors.push(`主键 [${key}] 已成功推送，无法重复推送`);
        }
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
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: id
      };
    }

    // --------------------------
    // 保存 ApiInputLog（在调用 MultiStepInvoker 之前）
    // --------------------------
    const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, null);
    
    // --------------------------
    // 调用 MultiStepInvoker 处理多步流程
    // zrfc_logid 和 zrfcid 的生成以及业务表的插入由 MultiStepInvoker 负责
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 调用 MultiStepInvoker，传入 SD03 作为固定的业务流程ID
    const invokerResult = await invoker.process('SD03', data, null, null, null, id);
    
    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    const result = {};
    if (invokerResult) {
      result.code = invokerResult.code === 'S' ? 200 : 400;
      result.message = invokerResult.message ? invokerResult.message.substring(0, 500) : '处理成功';
      result.zrfc_logid = invokerResult.zrfcLogid;
      result.zrfcid = invokerResult.zrfcid;
      result.id = id;
      if (invokerResult.objkey) {
        result.objkey = invokerResult.objkey;
      }
    } else {
      result.code = 200;
      result.message = '没有数据需要处理';
      result.id = id;
    }
    
    return result;
  });
});
