const express = require('express');
const router = express.Router();
const Article = require('../models/Article');

// 获取文章列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, pageSize = 10, category } = req.query;
    const skip = (page - 1) * pageSize;

    // 构建查询条件
    const query = {};
    if (category) {
      query.category = category;
    }

    const [articles, total] = await Promise.all([
      Article.find(query)
        .select('title content summary source url imageUrl publishDate likes views tags category')
        .sort({ publishDate: -1 })
        .skip(skip)
        .limit(parseInt(pageSize)),
      Article.countDocuments(query)
    ]);

    // 处理文章内容，生成摘要
    const processedArticles = articles.map(article => {
      const doc = article.toObject();
      if (!doc.summary) {
        doc.summary = doc.content.substring(0, 100) + '...';
      }
      return doc;
    });

    res.json({
      articles: processedArticles,
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

    // 增加浏览量
    article.views = (article.views || 0) + 1;
    await article.save();

    res.json(article);
  } catch (error) {
    console.error('获取文章详情错误:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 