const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Setting = require('../models/Setting');
const CrawlerService = require('../services/crawler');
const { keywords, addKeyword, removeKeyword } = require('../config/keywords');

// 中间件：验证管理员密码
const verifyPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    console.log('中间件验证密码:', { password });

    if (!password) {
      return res.status(401).json({ message: '需要密码' });
    }

    const admin = await Admin.findOne();
    if (!admin) {
      return res.status(401).json({ message: '需要先设置密码' });
    }

    const hashedInputPassword = Admin.hashPassword(password);
    if (admin.password !== hashedInputPassword) {
      return res.status(401).json({ message: '密码错误' });
    }

    next();
  } catch (error) {
    console.error('密码验证中间件错误:', error);
    res.status(500).json({ message: error.message });
  }
};

// 初始化或更改密码
router.post('/password', async (req, res) => {
  try {
    console.log('收到密码置请求:', req.body);
    const { password } = req.body;
    
    if (!password) {
      console.log('密码为空');
      return res.status(400).json({ message: '密码不能为空' });
    }

    console.log('查找现有管理员');
    const admin = await Admin.findOne();
    console.log('现有管理员:', admin);

    if (!admin || admin.isFirstLogin) {
      console.log('首次设置密码或重置密码');
      const hashedPassword = Admin.hashPassword(password);
      console.log('密码已加密');

      if (admin) {
        console.log('更新现有管理员');
        await admin.update({
          password: hashedPassword,
          isFirstLogin: false
        });
      } else {
        console.log('创建新管理员');
        await Admin.create({
          password: hashedPassword,
          isFirstLogin: false
        });
      }
      console.log('密码设置成功');
      res.json({ message: '密码设置成功' });
    } else {
      console.log('密码已经设置过');
      res.status(403).json({ message: '密码已经设置过' });
    }
  } catch (error) {
    console.error('密码设置错误:', error);
    res.status(500).json({ 
      message: error.message,
      stack: error.stack // 在开发环境中添加堆栈信息
    });
  }
});

// 修改密码
router.put('/password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    const admin = await Admin.findOne();
    if (!admin) {
      return res.status(401).json({ message: '管理员账户不存在' });
    }

    if (admin.password !== Admin.hashPassword(oldPassword)) {
      return res.status(401).json({ message: '原密码错误' });
    }

    await admin.update({
      password: Admin.hashPassword(newPassword)
    });

    res.json({ message: '密码修改成功' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 更新设置
router.post('/settings', verifyPassword, async (req, res) => {
  try {
    const { 
      crawlInterval, 
      preArticlesPerSource, 
      finalArticlesCount,
      autoCrawl
    } = req.body;
    
    await Setting.findOneAndUpdate(
      {},
      { 
        crawlInterval, 
        preArticlesPerSource, 
        finalArticlesCount,
        autoCrawl
      },
      { upsert: true }
    );

    // 如果自动抓取设置发生变化，更新爬虫任务
    const crawlerService = new CrawlerService();
    if (autoCrawl) {
      console.log('启动定时抓取任务');
      crawlerService.startCronJob();
    } else {
      console.log('停止定时抓取任务');
      crawlerService.stopCronJob();
    }

    res.json({ message: '设置更新成功' });
  } catch (error) {
    console.error('更新设置失败:', error);
    res.status(500).json({ message: error.message });
  }
});

// 手动触发抓取
router.post('/crawl', verifyPassword, async (req, res) => {
  try {
    const crawlerService = new CrawlerService();
    await crawlerService.manualFetch();
    res.json({ message: '抓取任务已执行' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 获取当前设置
router.get('/settings', verifyPassword, async (req, res) => {
  try {
    const setting = await Setting.findOne();
    res.json(setting || {
      crawlInterval: 240,
      preArticlesPerSource: 20,
      finalArticlesCount: 5,
      autoCrawl: false,
      lastCrawlTime: null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 修改检查路由
router.post('/settings/check', async (req, res) => {
  try {
    const { password } = req.body;
    console.log('收到密码验证请求:', { password });
    
    const admin = await Admin.findOne();
    console.log('查找到的管理员:', admin);
    
    if (!admin) {
      console.log('未找到管理员账户');
      return res.status(401).json({ message: '需要先设置密码' });
    }

    const hashedInputPassword = Admin.hashPassword(password);
    console.log('密码对比:', {
      stored: admin.password,
      input: hashedInputPassword
    });

    if (admin.password !== hashedInputPassword) {
      console.log('密码不匹配');
      return res.status(401).json({ message: '密码错误' });
    }

    console.log('密码验证成功，获取设置');
    const setting = await Setting.findOne();
    res.json(setting || {
      crawlInterval: 240,
      preArticlesPerSource: 20,
      finalArticlesCount: 5,
      autoCrawl: false,
      lastCrawlTime: null
    });
  } catch (error) {
    console.error('验证过程出错:', error);
    res.status(500).json({ message: error.message });
  }
});

// 获取所有关键词
router.get('/keywords', async (req, res) => {
  try {
    res.json(keywords);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 添加关键词
router.post('/keywords', async (req, res) => {
  try {
    const { category, keyword, password } = req.body;
    
    // 验证密码
    const admin = await Admin.findOne();
    if (!admin || admin.password !== Admin.hashPassword(password)) {
      return res.status(401).json({ message: '密码错误' });
    }

    addKeyword(category, keyword);
    res.json({ message: '关键词添加成功' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 删除关键词
router.delete('/keywords', async (req, res) => {
  try {
    const { category, keyword, password } = req.body;
    
    // 验证密码
    const admin = await Admin.findOne();
    if (!admin || admin.password !== Admin.hashPassword(password)) {
      return res.status(401).json({ message: '密码错误' });
    }

    removeKeyword(category, keyword);
    res.json({ message: '关键词删除成功' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 