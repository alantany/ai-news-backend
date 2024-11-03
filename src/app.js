const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const cron = require('node-cron');
const CrawlerService = require('./services/crawler');
const Setting = require('./models/Setting');
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

// 翻译未翻译的文章
async function translateUntranslatedArticles() {
  try {
    console.log('\n============= 开始翻译未翻译文章 =============');
    
    // 查找任一字段未翻译的文章
    const untranslatedArticles = await Article.find({
      $or: [
        { translatedTitle: { $exists: false } },
        { translatedContent: { $exists: false } },
        { translatedTitle: null },
        { translatedContent: null },
        { translatedTitle: '' },
        { translatedContent: '' }
      ]
    });
    
    console.log(`找到 ${untranslatedArticles.length} 篇需要翻译的文章`);

    // 翻译文章
    for (const article of untranslatedArticles) {
      try {
        console.log(`开始翻译文章: ${article.title}`);
        
        // 翻译标题和内容
        const [titleResult, contentResult] = await Promise.all([
          translate(article.title, { to: 'zh-CN' }),
          translate(article.content, { to: 'zh-CN' })
        ]);

        console.log('翻译结果:', {
          originalTitle: article.title,
          translatedTitle: titleResult.text,
          hasTranslatedContent: !!contentResult.text
        });

        // 更新文章
        const updatedArticle = await Article.findByIdAndUpdate(
          article._id,
          {
            $set: {
              translatedTitle: titleResult.text,
              translatedContent: contentResult.text,
              translatedSummary: generateSummary(contentResult.text),
              summary: generateSummary(article.content),
              isTranslated: true
            }
          },
          { new: true }
        );

        console.log('文章更新成功:', {
          id: updatedArticle._id,
          hasTranslatedTitle: !!updatedArticle.translatedTitle,
          hasTranslatedContent: !!updatedArticle.translatedContent
        });

        // 添加延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`翻译文章失败: ${article.title}`, error);
        continue;
      }
    }

    // 验证翻译结果
    const verifyArticles = await Article.find({
      isTranslated: true,
      translatedTitle: { $exists: true, $ne: null, $ne: '' },
      translatedContent: { $exists: true, $ne: null, $ne: '' }
    });
    console.log('翻译统计:', {
      totalArticles: await Article.countDocuments(),
      fullyTranslated: verifyArticles.length
    });

  } catch (error) {
    console.error('翻译过程失败:', error);
  }
}

let crawlJob = null;

// 更新定时任务
async function updateCrawlJob() {
  try {
    const settings = await Setting.findOne();
    if (!settings) {
      console.log('未找到设置，使用默认值');
      return;
    }

    if (crawlJob) {
      crawlJob.stop();
      console.log('停止旧的定时任务');
    }

    if (settings.autoCrawl) {
      const interval = settings.crawlInterval || 60;
      const cronExpression = `*/${interval} * * * *`;
      
      console.log('设置新的定时任务:', {
        interval,
        cronExpression,
        autoCrawl: settings.autoCrawl
      });

      crawlJob = cron.schedule(cronExpression, async () => {
        try {
          console.log('\n============= 开始定时抓取 =============');
          console.log('当前时间:', new Date().toISOString());
          
          // 1. 抓取新文章
          const crawler = new CrawlerService();
          await crawler.crawl();
          
          // 2. 翻译未翻译的文章
          await translateUntranslatedArticles();
          
          console.log('定时任务完成');
        } catch (error) {
          console.error('定时任务失败:', error);
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