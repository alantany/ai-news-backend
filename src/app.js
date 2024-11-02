const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
require('dotenv').config();
const path = require('path');

const app = express();

// 配置 CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 添加静态文件中间件，用于提供校验文件访问
app.use('/.well-known', express.static(path.join(__dirname, '../.well-known')));

// 导入所有模型
const Article = require('./models/Article');
const Admin = require('./models/Admin');
const Setting = require('./models/Setting');

// 连接数据库
connectDB();

// 添加路由日志中间件
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  console.log('Body:', req.body);
  next();
});

// API路由
const articlesRouter = require('./routes/articles');
const adminRouter = require('./routes/admin');

// 添加路由前缀
app.use('/api/articles', articlesRouter);
app.use('/api/admin', adminRouter);

// 添加一个测试路由
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'API is working',
    routes: {
      articles: '/api/articles',
      admin: '/api/admin',
      verify: '/api/admin/password/verify'
    }
  });
});

// 添加校验文件路由
app.get('/.well-known/verify-weapp.txt', (req, res) => {
  res.sendFile(path.join(__dirname, '../verify-weapp.txt'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('API错误:', err);
  res.status(500).json({ 
    error: err.message,
    path: req.path,
    method: req.method
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log('环境变量:', {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    MONGODB_URI: process.env.MONGODB_URI ? '已设置' : '未设置'
  });
  
  // 打印所有路由
  console.log('已注册的路由:');
  app._router.stack.forEach(r => {
    if (r.route && r.route.path) {
      console.log(`${Object.keys(r.route.methods)} ${r.route.path}`);
    }
  });
});

// 设置定时任务，每天抓取新文章
const cron = require('node-cron');
cron.schedule('0 */6 * * *', async () => {
  console.log('开始定时抓取任务');
  try {
    await CrawlerService.crawl();
  } catch (error) {
    console.error('定时抓取失败:', error);
  }
});

module.exports = app; 