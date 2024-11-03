const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const cron = require('node-cron');
const CrawlerService = require('./services/crawler');
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
  console.log('数据库连接成功');
  
  // 设置定时任务
  cron.schedule('0 */6 * * *', async () => {
    try {
      console.log('开始定时抓取任务');
      const crawler = new CrawlerService();
      await crawler.crawl();
    } catch (error) {
      console.error('定时抓取失败:', error);
    }
  });
}).catch(error => {
  console.error('数据库连接失败:', error);
});

// API路由
const articlesRouter = require('./routes/articles');
const adminRouter = require('./routes/admin');

app.use('/api/articles', articlesRouter);
app.use('/api/admin', adminRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});