const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const cron = require('node-cron');
require('dotenv').config();

const app = express();

// 配置 CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 连接数据库
connectDB().then(() => {
  // 只有在数据库连接成功后才启动定时任务
  cron.schedule('0 */6 * * *', async () => {
    console.log('开始定时抓取任务');
    try {
      const crawler = new CrawlerService();
      await crawler.crawl();
    } catch (error) {
      console.error('定时抓取失败:', error);
    }
  });
}).catch(error => {
  console.error('数据库连接失败，应用启动失败:', error);
  process.exit(1);
});

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
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});