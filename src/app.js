const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const cron = require('node-cron');
const CrawlerService = require('./services/crawler');
const Setting = require('./models/Setting');
const Article = require('./models/Article');
const { translate } = require('@vitalets/google-translate-api');
const path = require('path');
require('dotenv').config();
const { cleanOldArticles } = require('./services/cleaner');

const app = express();

// 配置 CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 添加静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// 生成摘要
function generateSummary(content, length = 100) {
  if (!content) return '';
  return content.length > length ? content.substring(0, length) + '...' : content;
}

// 清理摘要中的标签
function cleanSummary(text) {
  return text
    .replace(/<作者>.*?<\/作者>/g, '')
    .replace(/<摘要>/g, '')
    .replace(/<\/摘要>/g, '')
    .replace(/作者:.+?\n/g, '')
    .replace(/摘要:.+?\n/g, '')
    .trim();
}

// 添加延迟函数
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 添加重试翻译函数
async function retryTranslate(text, retries = 3) {
  if (!text) return { text: '' };
  
  for (let i = 0; i < retries; i++) {
    try {
      // 每次重试前添加延迟
      if (i > 0) {
        await delay(2000 * i);  // 递增延迟
      }
      return await translate(text, { to: 'zh-CN' });
    } catch (error) {
      console.error(`翻译失败 (尝试 ${i + 1}/${retries}):`, error.message);
      if (i === retries - 1) throw error;  // 最后一次尝试时抛出错误
    }
  }
}

// 翻译未翻译的文章
async function translateUntranslatedArticles() {
  try {
    console.log('\n============= 开始翻译未翻译文章 =============');
    
    const untranslatedArticles = await Article.find({
      $or: [
        { translatedTitle: { $exists: false } },
        { translatedContent: { $exists: false } },
        { translatedSummary: { $exists: false } },
        { translatedTitle: null },
        { translatedContent: null },
        { translatedSummary: null }
      ]
    });
    
    console.log(`找到 ${untranslatedArticles.length} 篇需要翻译的文章`);

    for (const article of untranslatedArticles) {
      try {
        console.log(`开始翻译文章: ${article.title}`);
        console.log('内容长度:', {
          title: article.title?.length || 0,
          content: article.content?.length || 0,
          summary: article.summary?.length || 0
        });
        
        if (!article.content) {
          console.log('警告: 文章内容为空');
        }
        if (!article.summary) {
          console.log('警告: 文章摘要为空');
        }

        // 使用重试机制翻译
        const [titleResult, contentResult, summaryResult] = await Promise.all([
          retryTranslate(article.title || ''),
          retryTranslate(article.content || ''),
          retryTranslate(article.summary || '')
        ]);

        // 更新文章
        const updatedArticle = await Article.findByIdAndUpdate(
          article._id,
          {
            $set: {
              translatedTitle: titleResult.text,
              translatedContent: contentResult.text,
              translatedSummary: summaryResult.text,
              isTranslated: true
            }
          },
          { new: true }
        );

        console.log('文章翻译成功:', {
          id: updatedArticle._id,
          hasTranslatedTitle: !!updatedArticle.translatedTitle,
          hasTranslatedContent: !!updatedArticle.translatedContent,
          hasTranslatedSummary: !!updatedArticle.translatedSummary
        });

        // 翻译成功后添加较长延迟，避免请求过快
        await delay(3000);
      } catch (error) {
        console.error(`翻译文章失败: ${article.title}`, error);
        console.error('错误详情:', {
          message: error.message,
          stack: error.stack
        });
        continue;
      }
    }

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
          try {
            const result = await translateUntranslatedArticles();
            if (result.error && result.error.includes('Too Many Requests')) {
              console.log('[定时任务] 检测到 API 请求限制，停止翻译流程');
              return;  // 直接退出定时任务
            }
          } catch (error) {
            if (error.constructor.name === 'TooManyRequestsError') {
              console.log('[定时任务] 检测到 API 请求限制，停止翻译流程');
              return;  // 直接退出定时任务
            }
            console.error('[定时任务] 翻译过程出错:', error);
          }
          
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
  console.log('检测到设置变，更新定时任务');
  await updateCrawlJob();
});

// 初始化时启动定时任务
connectDB().then(async () => {
  console.log('数据库连接成功');
  await updateCrawlJob();
}).catch(error => {
  console.error('数据库连接失败:', error);
});

// 每周日凌晨2点执行清理
cron.schedule('0 2 * * 0', async () => {
  console.log('开始清理旧文章...');
  try {
    const count = await cleanOldArticles();
    console.log(`文章清理完成，共清理 ${count} 篇`);
  } catch (error) {
    console.error('清理任务失败:', error);
  }
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

// 导出翻译函数
module.exports = {
  translateUntranslatedArticles
};