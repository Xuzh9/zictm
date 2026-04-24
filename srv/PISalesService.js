module.exports = cds.service.impl(async function () {
  const { SalesOrderCreate, SalesOrderChange } = this.entities;
  //创建
  this.on('Create', async (req) => {
    const { data } = req.data;
    if (!data || data.length === 0) req.error(400, "数据不能为空");

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.PISalesOrder) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：PISalesOrdero`);
      }
      if (!item.PISalesOrderItem) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：PISalesOrderItem`);
      }
    });

    // --------------------------
    // 批量内重复主键校验
    // --------------------------
    const keyMap = new Map();
    data.forEach((item, index) => {
      const rowNum = index + 1;
      const key = `${item.PISalesOrder}-${item.PISalesOrderItem}`;
      if (keyMap.has(key)) {
        req.error(400, `第 ${rowNum} 条数据与第 ${keyMap.get(key)} 条数据重复：主键 [${key}] 已存在`);
      } else {
        keyMap.set(key, rowNum);
      }
    });

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingKeys = await SELECT.from(SalesOrderCreate)
      .columns(['PISalesOrder', 'PISalesOrderItem'])
      .where({
        PISalesOrder: { in: data.map(p => p.PISalesOrder) }
      });

    existingKeys.forEach(existing => {
      const key = `${existing.PISalesOrder}-${existing.PISalesOrderItem}`;
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
    await INSERT.into(SalesOrderCreate).entries(data);

    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    return {
      code: 200,
      message: "批量创建成功",
    };
  });
  //修改
  this.on('Create', async (req) => {
    const { data } = req.data;
    if (!data || data.length === 0) req.error(400, "数据不能为空");

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.SalesOrder) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：SalesOrdero`);
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
    const existingKeys = await SELECT.from(SalesOrderChange)
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
    await INSERT.into(SalesOrderChange).entries(data);

    // --------------------------
    // 返回创建成功的数据
    // --------------------------
    return {
      code: 200,
      message: "批量修改成功",
    };
  });
});