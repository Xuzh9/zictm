const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const service = this;
  const { SELECT } = cds.ql;
  const { Transfer, PaymentReceipt, OutboundDelivery } = this.entities;
  
  //调拨单
  this.on('TrCreate', async (req) => {
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
      if (!item.TransferOrder) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：TransferOrder`);
      }
      if (!item.TransferOrderItem) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：TransferOrderItem`);
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
    const existingKeys = await service.run(SELECT.from(Transfer)
      .columns(['TransferOrder', 'TransferOrderItem', 'zrfc_logid'])
      .where({
        TransferOrder: { in: data.map(p => p.TransferOrder) }
      }));

    // 获取需要查询的 zrfc_logid 列表
    const zrfcLogids = existingKeys
      .filter(r => r.zrfc_logid)
      .map(r => r.zrfc_logid);
    
    // 查询 MultistepHeadLog 获取执行状态
    const headLogs = {};
    if (zrfcLogids.length > 0) {
      const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
      const logs = await cds.run(SELECT.from(MultistepHeadLog)
        .columns(['zrfc_logid', 'code'])
        .where({ zrfc_logid: { in: zrfcLogids } }));
      logs.forEach(log => {
        headLogs[log.zrfc_logid] = log.code;
      });
    }

    existingKeys.forEach(existing => {
      const key = `${existing.TransferOrder}-${existing.TransferOrderItem}`;
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
    
    // 调用 MultiStepInvoker，传入业务流程ID和三个业务表的数据
    const invokerResult = await invoker.process('MM01', data, null, null, null, id);

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
  //收付款单
  this.on('PrCreate', async (req) => {
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
      if (!item.paymentReceiptNo) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：paymentReceiptNo`);
      }
      if (!item.paymentReceiptNoItem) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：paymentReceiptNoItem`);
      }
      if (!item.documentType) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：documentType`);
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
    const existingKeys = await service.run(SELECT.from(PaymentReceipt)
      .columns(['paymentReceiptNo', 'paymentReceiptNoItem'])
      .where({
        paymentReceiptNo: { in: data.map(p => p.paymentReceiptNo) }
      }));

    existingKeys.forEach(existing => {
      const key = `${existing.paymentReceiptNo}-${existing.paymentReceiptNoItem}`;
      if (keyMap.has(key)) {
        errors.push(`主键 [${key}] 已在数据库中存在，无法重复创建`);
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
    
    // 调用 MultiStepInvoker，传入业务流程ID和三个业务表的数据
    const invokerResult = await invoker.process('FI01', data, null, null, null, id);

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
  //销售出库
  this.on('OdCreate', async (req) => {
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
      if (!item.SalesOrder) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：SalesOrder`);
      }
      if (!item.SalesOrderItem) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：SalesOrderItem`);
      }
      if (!item.SalesOrganization) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：SalesOrganization`);
      }
      if (!item.SalesOrderType) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：SalesOrderType`);
      }
      if (!item.Customer) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：Customer`);
      }
      if (!item.SalesOffice) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：SalesOffice`);
      }
      if (!item.NetAmount && item.NetAmount !== 0) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：NetAmount`);
      }
      if (!item.RequestedQuantity && item.RequestedQuantity !== 0) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：RequestedQuantity`);
      }
      if (!item.ItemTransactionCurrency) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：ItemTransactionCurrency`);
      }
      if (!item.ReceivingStorageLocation) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：ReceivingStorageLocation`);
      }
      if (!item.DeliveryDate) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：DeliveryDate`);
      }
      if (!item.ReceivingPlant) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：ReceivingPlant`);
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
    try {
      const existingRecords = await service.run(SELECT.from(OutboundDelivery)
        .columns(['SalesOrder', 'SalesOrderItem', 'zrfc_logid'])
        .where({
          SalesOrder: { in: data.map(p => p.SalesOrder) }
        }));
      
      // 获取需要查询的 zrfc_logid 列表
      const zrfcLogids = existingRecords
        .filter(r => r.zrfc_logid)
        .map(r => r.zrfc_logid);
      
      // 查询 MultistepHeadLog 获取执行状态
      const headLogs = {};
      if (zrfcLogids.length > 0) {
        const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];
        const logs = await cds.run(SELECT.from(MultistepHeadLog)
          .columns(['zrfc_logid', 'code'])
          .where({ zrfc_logid: { in: zrfcLogids } }));
        logs.forEach(log => {
          headLogs[log.zrfc_logid] = log.code;
        });
      }
      
      // 将已存在记录转换为 Map，方便快速查找
      const existingKeyMap = new Map();
      existingRecords.forEach(existing => {
        const key = `${existing.SalesOrder}-${existing.SalesOrderItem}`;
        existingKeyMap.set(key, existing.zrfc_logid);
      });
      
      // 检查当前请求的数据是否在数据库中已存在且状态为成功
      data.forEach((item, index) => {
        const rowNum = index + 1;
        const key = `${item.SalesOrder}-${item.SalesOrderItem}`;
        if (existingKeyMap.has(key)) {
          const zrfcLogid = existingKeyMap.get(key);
          const headLogCode = headLogs[zrfcLogid];
          if (headLogCode === 'S') {
            errors.push(`第 ${rowNum} 条数据的主键 [${key}] 已成功推送，无法重复推送`);
          }
          // 如果状态不是成功（可能是失败或处理中），则允许更新业务表并重推，不报错
        }
      });
    } catch (error) {
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, `数据库查询失败: ${error.message}`);
      return {
        code: 500,
        message: `数据库查询失败: ${error.message}`,
        id: id
      };
    }

    // --------------------------
    // 根据 SalesOrganization 和 ReceivingPlant 查询 MPTTypeConfig
    // SalesOrganization = zxsf（销售方）, ReceivingPlant = zfcf（发出方）
    // --------------------------
    const firstData = data[0];
    let mptConfig = null;
    
    // 防御性检查：确保 SalesOrganization 和 ReceivingPlant 存在
    if (!firstData.SalesOrganization) {
      errors.push('缺少必填字段：SalesOrganization');
      const errorMessages = errors.join('; ');
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: id
      };
    }
    
    if (!firstData.ReceivingPlant) {
      errors.push('缺少必填字段：ReceivingPlant');
      const errorMessages = errors.join('; ');
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, errorMessages);
      return {
        code: 400,
        message: errorMessages,
        id: id
      };
    }
    
    try {
      // 使用 cds.run() 来查询不在当前服务中的实体
      const MPTTypeConfig = cds.entities['com.sap.zictm.MPTTypeConfig'];
      mptConfig = await cds.run(SELECT.one(MPTTypeConfig)
      .columns(['zrfcid', 'zdfjy'])
      .where({
        zxsf: firstData.SalesOrganization,
        zfcf: firstData.ReceivingPlant,
        system: '数帝'
      }));

      if (!mptConfig) {
        errors.push(`未找到多方交易类型配置：SalesOrganization=${firstData.SalesOrganization}, ReceivingPlant=${firstData.ReceivingPlant}`);
      }
    } catch (error) {
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, `MPTTypeConfig 查询失败: ${error.message}`);
      return {
        code: 500,
        message: `MPTTypeConfig 查询失败: ${error.message}`,
        id: id
      };
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
    // 传入查询到的 zrfcid 和 zdfjy
    // --------------------------
    const MultiStepInvoker = require('./handlers/MultiStepInvoker');
    const invoker = new MultiStepInvoker();
    
    // 调用 MultiStepInvoker，传入业务流程ID、数据和 zdfjy
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
});