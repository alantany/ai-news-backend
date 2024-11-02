const express = require('express');
const router = express.Router();
const Article = require('../models/Article');
const fetch = require('node-fetch');

// 获取文章总数
router.get('/count', async (req, res) => {
  try {
    const count = await Article.countDocuments();
    res.json({ count });
  } catch (error) {
    console.error('获取文章总数失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 获取文章列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    const [articles, total] = await Promise.all([
      Article.find()
        .select('title summary source url publishDate likes views category')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(pageSize)),
      Article.countDocuments()
    ]);

    res.json({
      articles,
      total,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error('获取文章列表错误:', error);
    res.status(500).json({ message: error.message });
  }
});

// 点赞文章
router.post('/:id/like', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ message: '文章不存在' });
    }
    
    article.likes = (article.likes || 0) + 1;
    await article.save();
    
    res.json({ likes: article.likes });
  } catch (error) {
    console.error('点赞文章错误:', error);
    res.status(500).json({ message: error.message });
  }
});

// 获取文章详情
router.get('/:id', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) {
      return res.status(404).json({ message: '文章不存在' });
    }
    
    // 更新浏览量
    article.views = (article.views || 0) + 1;
    await article.save();
    
    res.json(article);
  } catch (error) {
    console.error('获取文章详情错误:', error);
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

module.exports = router; 