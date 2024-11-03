const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const cron = require('node-cron');
const CrawlerService = require('./services/crawler');
const Article = require('./models/Article');
const { translate } = require('@vitalets/google-translate-api');
const Setting = require('./models/Setting');
require('dotenv').config();

const app = express();

// 配置 CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 生成摘要
function generateSummary(content, length = 100) {
  if (!content) return '';
  return content.length > length ? content.substring(0, length) + '...' : content;
}

let crawlJob = null;  // 用于存储定时任务实例

// 更新定时任务
async function updateCrawlJob() {
  try {
    const settings = await Setting.findOne();
    if (!settings) {
      console.log('未找到设置，使用默认值');
      return;
    }

    // 停止现有的定时任务
    if (crawlJob) {
      crawlJob.stop();
      console.log('停止旧的定时任务');
    }

    // 如果启用了自动抓取
    if (settings.autoCrawl) {
      const interval = settings.crawlInterval || 60;  // 默认60分钟
      const cronExpression = `*/${interval} * * * *`;  // 每 x 分钟执行一次
      
      console.log('设置新的定时任务:', {
        interval,
        cronExpression,
        autoCrawl: settings.autoCrawl
      });

      crawlJob = cron.schedule(cronExpression, async () => {
        try {
          console.log('\n============= 开始定时抓取 =============');
          console.log('当前时间:', new Date().toISOString());
          
          const crawler = new CrawlerService();
          await crawler.crawl();
          
          // 翻译未翻译的文章
          await translateUntranslatedArticles();
          
          console.log('定时抓取完成');
        } catch (error) {
          console.error('定时抓取失败:', error);
        }
      });

      console.log('定时任务已启动');
    } else {
      console.log('自动抓取已禁用');
    }
  } catch (error) {
    console.error('更新定时任务失败:', error);
  }
}

// 监听设置变化
Setting.watch().on('change', async () => {
  console.log('检测到设置变化，更新定时任务');
  await updateCrawlJob();
});

// 初始化时启动定时任务
connectDB().then(async () => {
  console.log('数据库连接成功');
  await updateCrawlJob();
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