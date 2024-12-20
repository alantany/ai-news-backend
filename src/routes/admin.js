const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Setting = require('../models/Setting');
const CrawlerService = require('../services/crawler');
const Article = require('../models/Article');
const { translateUntranslatedArticles } = require('../services/translator');  // 从新文件导入

// 验证密码
router.post('/password/verify', async (req, res) => {
  try {
    console.log('收到密码验证请求:', req.body);
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ message: '密码不能为空' });
    }

    // 获取管理员设置
    const admin = await Admin.findOne();
    
    // 如果没有管理员记录，创建一个默认的
    if (!admin) {
      const defaultAdmin = await Admin.create({
        password: Admin.hashPassword('admin123'), // 默认密码
        isFirstLogin: true
      });
      console.log('创建默认管理员账户');
    }

    // 验证密码
    const hashedPassword = Admin.hashPassword(password);
    const isValid = admin ? (hashedPassword === admin.password) : (password === 'admin123');

    if (isValid) {
      res.json({ message: '验证成功' });
    } else {
      res.status(401).json({ message: '密码错误' });
    }
  } catch (error) {
    console.error('密码验证错误:', error);
    res.status(500).json({ message: error.message });
  }
});

// 获取设置
router.get('/settings', async (req, res) => {
  try {
    const settings = await Setting.findOne();
    res.json(settings || {});
  } catch (error) {
    console.error('获取设置错误:', error);
    res.status(500).json({ message: error.message });
  }
});

// 更新设置
router.post('/settings', async (req, res) => {
  try {
    console.log('更新设置请求:', req.body);
    
    const settings = await Setting.findOne();
    if (settings) {
      Object.assign(settings, req.body);
      await settings.save();
    } else {
      await Setting.create(req.body);
    }

    console.log('设置已更新');
    res.json({ message: '设置已更新' });
  } catch (error) {
    console.error('更新设置失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 手动抓取
router.post('/crawl', async (req, res) => {
  try {
    console.log('手动抓取请求');
    const crawler = new CrawlerService();
    const articles = await crawler.crawl();
    
    // 抓取完成后立即触发翻译
    console.log('开始翻译新抓取的文章');
    await translateUntranslatedArticles();
    
    res.json({ message: '抓取和翻译完成', count: articles.length });
  } catch (error) {
    console.error('手动抓取失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 清除所有文章
router.post('/clear-articles', async (req, res) => {
  try {
    console.log('收到清除文章请求');
    
    // 使用 deleteMany 确保完全清除
    const result = await Article.deleteMany({});
    console.log('清除结果:', {
      acknowledged: result.acknowledged,
      deletedCount: result.deletedCount
    });

    // 验证是否完全清除
    const remainingCount = await Article.countDocuments();
    console.log('剩余文章数:', remainingCount);

    if (remainingCount > 0) {
      // 如果还有剩余，强制再次清除
      await Article.collection.drop();
      console.log('强制清除完成');
    }

    res.json({ 
      message: `清理完成，共删除 ${result.deletedCount} 篇文章`,
      remainingCount: await Article.countDocuments()
    });
  } catch (error) {
    console.error('清除文章失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 添加一个调试接口
router.get('/debug/articles', async (req, res) => {
  try {
    // 获取最近10篇文章的关键信息
    const recentArticles = await Article.find({})
      .select('title translatedTitle publishDate isTranslated')
      .sort({ publishDate: -1 })
      .limit(10)
      .lean();
      
    // 获取统计信息
    const stats = {
      total: await Article.countDocuments(),
      translated: await Article.countDocuments({ isTranslated: true }),
      untranslated: await Article.countDocuments({ isTranslated: false }),
      nullTitle: await Article.countDocuments({ title: null }),
      nullTranslatedTitle: await Article.countDocuments({ translatedTitle: null })
    };
    
    res.json({
      stats,
      recentArticles
    });
  } catch (error) {
    console.error('获取调试信息失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 添加翻译状态检查接口
router.get('/check-translations', async (req, res) => {
  try {
    const articles = await Article.find({}).lean();
    
    const stats = {
      total: articles.length,
      translated: 0,
      untranslated: 0,
      suspicious: 0,  // 可疑的翻译（比如标题相同）
      details: []
    };

    articles.forEach(article => {
      if (!article.isTranslated || !article.translatedTitle) {
        stats.untranslated++;
        stats.details.push({
          id: article._id,
          title: article.title,
          status: '未翻译',
          reason: !article.isTranslated ? 'isTranslated为false' : '无翻译标题'
        });
      } else if (article.title === article.translatedTitle) {
        stats.suspicious++;
        stats.details.push({
          id: article._id,
          title: article.title,
          status: '可疑',
          reason: '原文与译文相同'
        });
      } else {
        stats.translated++;
      }
    });

    res.json(stats);
  } catch (error) {
    console.error('检查翻译状态失败:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 