require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '10mb' }));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// API 路由
app.use('/api', apiRoutes);

// 前端页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 导航站已启动: http://localhost:${PORT}`);
  console.log(`📋 API: /api/data | /api/login | /api/export | /api/import | /api/category | /api/link`);
});
