const cds = require('@sap/cds')
const axios = require('axios')

module.exports = cds.service.impl(async (srv) => {

  srv.on('READ', 'A_Product', async (req) => {
    try {
      // 你的认证信息
      const auth = 'Basic ' + Buffer.from('CS_SUNLUOA:(u9uML/ALMk9AT>JJ5-KoLi9[EZAM}youWPvSh3R').toString('base64')

      // 直接调用 S/4HANA
      const resp = await axios({
        method: 'get',
        url: 'https://my201417.s4hana.sapcloud.cn/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product',
        headers: {
          'Authorization': auth,
          'sap-client': '100',
          'Accept': 'application/json'
        }
      })

      // 安全返回数据（不猜格式！直接输出真实内容！）
      return resp.data

    } catch (err) {
      console.log('ERROR', err.response?.data || err.message)
      req.error(500, '调用失败: ' + (err.response?.data?.error?.message || err.message))
    }
  })
})