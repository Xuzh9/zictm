module.exports = cds.service.impl(async function () {
  const { DeliveryActualInfo } = this.entities;
  //交货
  this.on('DN', async (req) => {
    const { data } = req.data;
    if (!data || data.length === 0) req.error(400, "数据不能为空");

    // --------------------------
    // 基础空值校验
    // --------------------------
    data.forEach((item, index) => {
      const rowNum = index + 1;
      if (!item.DeliveryDocument) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：DeliveryDocument`);
      }
      if (!item.DeliveryDocumentItem) {
        req.error(400, `第 ${rowNum} 条数据缺少必填字段：DeliveryDocumentItem`);
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
        req.error(400, `第 ${rowNum} 条数据与第 ${keyMap.get(key)} 条数据重复：主键 [${key}] 已存在`);
      } else {
        keyMap.set(key, rowNum);
      }
    });

    // --------------------------
    // 数据库已存在校验
    // --------------------------
    const existingKeys = await cds.run(SELECT.from(DeliveryActualInfo)
      .columns(['DeliveryDocument', 'DeliveryDocumentItem'])
      .where({
        DeliveryDocument: { in: data.map(p => p.DeliveryDocument) }
      }));

    existingKeys.forEach(existing => {
      const key = `${existing.DeliveryDocument}-${existing.DeliveryDocumentItem}`;
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
    await cds.run(INSERT.into(DeliveryActualInfo).entries(data));

    // --------------------------
    // 返回成功
    // --------------------------
    return {
      code: 200,
      message: "推送成功",
    };
  });
});