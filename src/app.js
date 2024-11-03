const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const cron = require('node-cron');
const CrawlerService = require('./services/crawler');
const Article = require('./models/Article');
const { translate } = require('@vitalets/google-translate-api');
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

// 连接数据库
connectDB().then(() => {
  console.log('数据库连接成功');
  
  // 设置定时任务
  cron.schedule('0 */6 * * *', async () => {
    try {
      console.log('\n============= 开始定时任务 =============');
      
      // 1. 抓取新文章
      const crawler = new CrawlerService();
      await crawler.crawl();
      
      // 2. 查找未翻译的文章
      const untranslatedArticles = await Article.find({
        $or: [
          { translatedTitle: { $exists: false } },
          { translatedContent: { $exists: false } },
          { translatedTitle: null },
          { translatedContent: null }
        ]
      });
      
      console.log(`找到 ${untranslatedArticles.length} 篇未翻译的文章`);

      // 3. 翻译文章
      for (const article of untranslatedArticles) {
        try {
          console.log(`翻译文章: ${article.title}`);
          
          // 翻译标题和内容
          const [titleResult, contentResult] = await Promise.all([
            translate(article.title, { to: 'zh-CN' }),
            translate(article.content, { to: 'zh-CN' })
          ]);

          // 更新文章
          article.translatedTitle = titleResult.text;
          article.translatedContent = contentResult.text;
          article.translatedSummary = generateSummary(contentResult.text);
          article.summary = generateSummary(article.content);
          article.isTranslated = true;
          
          await article.save();
          console.log('翻译完成并保存');
          
          // 添加延迟避免请求过快
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`翻译文章失败: ${article.title}`, error);
          continue;
        }
      }

      console.log('定时任务完成');
    } catch (error) {
      console.error('定时任务失败:', error);
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