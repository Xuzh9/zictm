const cds = require('@sap/cds')
const express = require('express')
const LIMIT = '10mb'

// CDS 初始化第一时间挂载，优先级高于OData内置解析器
cds.on('bootstrap', app => {
  app.use(express.json({ limit: LIMIT }))
  app.use(express.text({ limit: LIMIT }))
  app.use(express.urlencoded({ limit: LIMIT, extended: true }))
  console.log('✅ 全局BodyParser限制已覆盖为10MB')
})

module.exports = cds.server