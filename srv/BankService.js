const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const service = this;
  const { BankInfo } = this.entities;

  /**
   * 更新银行信息（批量）
   * 根据 bankAccountNo 和 bankReceiptNo 判断是新增还是更新
   * @param {Object} req - 请求对象
   * @param {Array} req.data.data - BankInfo 数据列表
   * @returns {Object} 操作结果
   */
  this.on('update', async (req) => {
    console.log('[BankService.update] 开始处理银行信息更新请求');
    
    try {
      const { data } = req.data;

      // --------------------------
      // 参数校验
      // --------------------------
      if (!data || !Array.isArray(data)) {
        return {
          code: 400,
          message: '数据格式错误：data 必须是数组'
        };
      }

      if (data.length === 0) {
        return {
          code: 400,
          message: '数据不能为空'
        };
      }

      // --------------------------
      // 批量校验必填字段（参考 PIService.js 的方式）
      // --------------------------
      const errors = [];
      data.forEach((item, index) => {
        const rowNum = index + 1;

        if (!item.bankAccountNo) {
          errors.push(`第 ${rowNum} 条数据缺少必填字段：bankAccountNo`);
        }
        if (!item.bankReceiptNo) {
          errors.push(`第 ${rowNum} 条数据缺少必填字段：bankReceiptNo`);
        }
      });

      // 如果有错误，一次性返回所有错误
      if (errors.length > 0) {
        return {
          code: 400,
          message: errors.join('; ')
        };
      }

      // --------------------------
      // 收集所有要查询的键
      // --------------------------
      const bankAccountNoList = data.map(item => item.bankAccountNo);

      // --------------------------
      // 批量查询已存在的记录（使用 IN 子句）
      // --------------------------
      const existingRecords = bankAccountNoList.length > 0 
        ? await cds.run(
            SELECT.from(BankInfo)
              .where({ 
                bankAccountNo: { in: [...new Set(bankAccountNoList)] }
              })
          )
        : [];

      // 构建已存在的键集合（需要验证两个字段都匹配）
      const existingKeySet = new Set(
        existingRecords.map(record => `${record.bankAccountNo}-${record.bankReceiptNo}`)
      );

      // --------------------------
      // 分离需要新增和更新的数据
      // --------------------------
      const insertList = [];
      const updateList = [];

      data.forEach((item) => {
        const key = `${item.bankAccountNo}-${item.bankReceiptNo}`;

        if (existingKeySet.has(key)) {
          // 记录存在，加入更新列表
          updateList.push(item);
        } else {
          // 记录不存在，加入新增列表
          insertList.push(item);
        }
      });

      // --------------------------
      // 批量执行操作
      // --------------------------

      // 批量新增
      if (insertList.length > 0) {
        console.log(`[BankService.update] 批量新增 ${insertList.length} 条数据`);
        await cds.run(INSERT.into(BankInfo).entries(insertList));
      }

      // 批量更新（仅更新有传值的字段）
      if (updateList.length > 0) {
        console.log(`[BankService.update] 批量更新 ${updateList.length} 条数据`);
        for (const item of updateList) {
          // 动态构建更新对象，只包含有值的字段
          const updateFields = {};
          if (item.shortUrl !== undefined && item.shortUrl !== null) {
            updateFields.shortUrl = item.shortUrl;
          }
          if (item.memoLine !== undefined && item.memoLine !== null) {
            updateFields.memoLine = item.memoLine;
          }
          
          // 如果没有需要更新的字段，跳过
          if (Object.keys(updateFields).length === 0) {
            continue;
          }
          
          await cds.run(
            UPDATE(BankInfo)
              .set(updateFields)
              .where({ 
                bankAccountNo: item.bankAccountNo,
                bankReceiptNo: item.bankReceiptNo
              })
          );
        }
      }

      console.log('[BankService.update] 处理完成');

      // 返回结果（参考 PIService 格式）
      return {
        code: 200,
        message: '处理成功'
      };

    } catch (error) {
      console.error('[BankService.update] 处理失败:', error);
      return {
        code: 500,
        message: error.message || '处理失败'
      };
    }
  });
});