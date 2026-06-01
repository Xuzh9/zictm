const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const service = this;
  const { DeliveryActualInfo } = this.entities;
  
  // 获取 MultistepLog 实体引用
  const MultistepHeadLog = cds.entities['com.sap.zictm.MultistepHeadLog'];

  //交货
  this.on('DN', async (req) => {
    console.log('[DN] 开始处理请求');
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
    // 从第一个数据项获取 zrfcid
    // --------------------------
    const zrfcid = data[0].zrfcid;
    
    // --------------------------
    // 检查 zrfcid 是否传入
    // --------------------------
    if (!zrfcid) {
      const id = await ApiInputLogHelper.saveApiInputLog({ businessTable1: data }, '缺少必填参数：zrfcid');
      return {
        code: 400,
        message: '缺少必填参数：zrfcid',
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
      if (!item.DeliveryDocument) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：DeliveryDocument`);
      }
      if (!item.DeliveryDocumentItem) {
        errors.push(`第 ${rowNum} 条数据缺少必填字段：DeliveryDocumentItem`);
      }
    });

    // --------------------------
    // 批量内重复主键校验
    // --------------------------
    const keyMap = new Map();
    data.forEach((item, index) => {
      const rowNum = index + 1;
      const key = `${item.DeliveryDocument}-${item.DeliveryDocumentItem}`;
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
    const invokerResult = await invoker.process(zrfcid, data, null, null, null, id);
    
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