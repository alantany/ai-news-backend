const express = require('express');
const router = express.Router();
const Article = require('../models/Article');
const fetch = require('node-fetch');
const { translate } = require('@vitalets/google-translate-api');

// 添加延迟函数
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 带重试的翻译函数
async function translateWithRetry(text, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      // 添加随机延迟，避免请求过快
      await delay(1000 + Math.random() * 2000);
      const result = await translate(text, { to: 'zh-CN' });
      return result.text;
    } catch (error) {
      console.log(`翻译失败，重试次数剩余 ${retries - i - 1}`);
      if (i === retries - 1) throw error;
      // 失败后等待更长时间
      await delay(3000 + Math.random() * 2000);
    }
  }
}

// 使用内存缓存，定期批量更新数据库
const statsCache = {
  likes: new Map(),
  stars: new Map(),
  reads: new Map()
};

// 定期将缓存写入数据库
setInterval(async () => {
  try {
    // 处理点赞数据
    for (const [id, count] of statsCache.likes) {
      await Article.findByIdAndUpdate(id, { $inc: { likes: count } });
      statsCache.likes.delete(id);
    }
    
    // 处理收藏数据
    for (const [id, count] of statsCache.stars) {
      await Article.findByIdAndUpdate(id, { $inc: { stars: count } });
      statsCache.stars.delete(id);
    }
    
    // 处理阅读数据
    for (const [id, count] of statsCache.reads) {
      await Article.findByIdAndUpdate(id, { $inc: { reads: count } });
      statsCache.reads.delete(id);
    }
  } catch (error) {
    console.error('批量更新统计数据失败:', error);
  }
}, 5000);  // 每5秒更新一次数据库

// 获取文章总数
router.get('/count', async (req, res) => {
  try {
    const count = await Article.countDocuments();
    res.json({ count });
  } catch (error) {
    console.error('获取文章数量失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 添加文章索引
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // 先查询所有文章，包括未翻译的
    const allArticles = await Article.find({})
      .sort({ publishDate: -1 })
      .lean();
    
    // 检查未翻译的文章
    const untranslatedArticles = allArticles.filter(article => {
      const needsTranslation = !article.isTranslated || 
                              !article.translatedTitle ||
                              article.title === article.translatedTitle;  // 标题相同可能意味着翻译失败
      
      if (needsTranslation) {
        console.log('[articles] 发现未翻译文章:', {
          id: article._id,
          title: article.title,
          translatedTitle: article.translatedTitle,
          isTranslated: article.isTranslated,
          publishDate: article.publishDate
        });
      }
      return needsTranslation;
    });

    console.log('[articles] 翻译状态统计:', {
      总文章数: allArticles.length,
      未翻译数: untranslatedArticles.length,
      未翻译文章ID列表: untranslatedArticles.map(a => a._id)
    });

    // 使用原来的查询继续处理
    const query = { isTranslated: true };
    const articles = await Article.find(query)
      .sort({ publishDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    res.json({
      articles,
      pagination: {
        current: page,
        total: Math.ceil(allArticles.length / limit),
        pageSize: limit,
        totalItems: allArticles.length
      }
    });
  } catch (error) {
    console.error('[articles] 获取文章列表失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 点赞文章
router.post('/:id/like', async (req, res) => {
  try {
    console.log('[ai-news-backend] POST /api/articles/:id/like 收到点赞请求:', req.params.id);
    
    // 使用 findOneAndUpdate 确保更新成功
    const article = await Article.findOneAndUpdate(
      { _id: req.params.id },
      { $inc: { likes: 1 } },
      { 
        new: true,  // 返回更新后的文档
        runValidators: true  // 运行验证
      }
    );
    
    if (!article) {
      console.log('文章不存在');
      return res.status(404).json({ message: '文章不存在' });
    }

    console.log('点赞成功，更新后的数据:', {
      id: article._id,
      likes: article.likes,
      updateTime: new Date()
    });
    
    res.json(article);
  } catch (error) {
    console.error('[ai-news-backend] 点赞失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 收藏文章
router.post('/:id/star', async (req, res) => {
  try {
    console.log('收到收藏请求:', req.params.id);
    
    const article = await Article.findOneAndUpdate(
      { _id: req.params.id },
      { $inc: { stars: 1 } },
      { 
        new: true,
        runValidators: true
      }
    );
    
    if (!article) {
      console.log('文章不存在');
      return res.status(404).json({ message: '文章不存在' });
    }

    console.log('收藏成功，更新后的数据:', {
      id: article._id,
      stars: article.stars,
      updateTime: new Date()
    });
    
    res.json(article);
  } catch (error) {
    console.error('收藏失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 更新阅读数
router.post('/:id/read', async (req, res) => {
  try {
    console.log('收到阅读请求:', req.params.id);
    
    const article = await Article.findOneAndUpdate(
      { _id: req.params.id },
      { $inc: { reads: 1 } },
      { 
        new: true,
        runValidators: true
      }
    );
    
    if (!article) {
      console.log('文章不存在');
      return res.status(404).json({ message: '文章不存在' });
    }

    console.log('更新阅读数成功，更新后的数据:', {
      id: article._id,
      reads: article.reads,
      updateTime: new Date()
    });
    
    res.json(article);
  } catch (error) {
    console.error('更新阅读数失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 获取文章详情
router.get('/:id', async (req, res) => {
  try {
    console.log('获取文章详情，ID:', req.params.id);
    const article = await Article.findById(req.params.id);
    
    if (!article) {
      console.log('文章不存在');
      return res.status(404).json({ message: '文章不存在' });
    }

    console.log('文章获取成功，内容长度:', article.content?.length || 0);
    res.json(article);
  } catch (error) {
    console.error('获取文章详情失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 修改代理路由，返回一个完整的 HTML 页面
router.get('/proxy/:id', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ message: '文章不存在' });
    }

    // 构建一个美观的静态页面
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>${article.title}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background: #f9f9f9;
            }
            .container {
              background: white;
              padding: 20px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 {
              font-size: 24px;
              margin-bottom: 10px;
              color: #1a1a1a;
            }
            .meta {
              font-size: 14px;
              color: #666;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 1px solid #eee;
            }
            .content {
              font-size: 16px;
            }
            .content img {
              max-width: 100%;
              height: auto;
              margin: 10px 0;
            }
            .original-link {
              margin-top: 20px;
              padding-top: 20px;
              border-top: 1px solid #eee;
              font-size: 14px;
              color: #666;
            }
            a {
              color: #0066cc;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>${article.title}</h1>
            <div class="meta">
              <div>来源：${article.source}</div>
              <div>发布时间：${new Date(article.publishDate).toLocaleString('zh-CN')}</div>
            </div>
            <div class="content">
              ${article.content}
            </div>
            <div class="original-link">
              <a href="${article.url}" target="_blank">查看原文</a>
            </div>
          </div>
          <script>
            // 处理所有图片链接，确保是 HTTPS
            document.querySelectorAll('img').forEach(img => {
              if (img.src.startsWith('http:')) {
                img.src = img.src.replace('http:', 'https:');
              }
            });
          </script>
        </body>
      </html>
    `;

    // 设置正确的内容类型和缓存控制
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(htmlContent);
  } catch (error) {
    console.error('代理请求失败:', error);
    res.status(500).send(`
      <html>
        <body>
          <h1>加载失败</h1>
          <p>${error.message}</p>
          <p><a href="${article?.url}">点击访问原文</a></p>
        </body>
      </html>
    `);
  }
});

// 获取或创建文章翻译
router.post('/:id/translate', async (req, res) => {
  try {
    console.log('翻译文章，ID:', req.params.id);
    const article = await Article.findById(req.params.id);
    
    if (!article) {
      console.log('文章不存在');
      return res.status(404).json({ message: '文章不存在' });
    }

    // 如果已经翻译过，直接返回
    if (article.isTranslated) {
      return res.json({
        title: article.translatedTitle,
        content: article.translatedContent,
        summary: article.translatedSummary
      });
    }

    // 分步进行翻译，每步都有重试机制
    try {
      console.log('开始翻译标题...');
      const translatedTitle = await translateWithRetry(article.title);
      
      console.log('开始翻译内容...');
      const translatedContent = await translateWithRetry(article.content);
      
      // 生成摘要并翻译
      const summary = article.content.substring(0, 200) + '...';
      console.log('开始翻译摘要...');
      const translatedSummary = await translateWithRetry(summary);

      // 更新文章
      article.translatedTitle = translatedTitle;
      article.translatedContent = translatedContent;
      article.translatedSummary = translatedSummary;
      article.isTranslated = true;
      await article.save();

      console.log('翻译完成保存');
      res.json({
        title: article.translatedTitle,
        content: article.translatedContent,
        summary: article.translatedSummary
      });
    } catch (error) {
      console.error('翻译过程失败:', error.message);
      res.status(500).json({ message: '翻译失败，请稍后重试' });
    }
  } catch (error) {
    console.error('翻译文章失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 更新分享数
router.post('/:id/share', async (req, res) => {
  try {
    console.log('收到分享请求:', req.params.id);
    
    const article = await Article.findOneAndUpdate(
      { _id: req.params.id },
      { $inc: { shares: 1 } },
      { 
        new: true,
        runValidators: true
      }
    );
    
    if (!article) {
      console.log('文章不存在');
      return res.status(404).json({ message: '文章不存在' });
    }

    console.log('更新分享数成功，更新后的数据:', {
      id: article._id,
      shares: article.shares,
      updateTime: new Date()
    });
    
    res.json(article);
  } catch (error) {
    console.error('更新分享数失败:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 