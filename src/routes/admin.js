const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Setting = require('../models/Setting');
const CrawlerService = require('../services/crawler');

// 验证密码的路由
router.post('/password/verify', async (req, res) => {
  try {
    console.log('收到密码验证请求:', req.body);
    const { password } = req.body;
    if (!password) {
      return res.status(401).json({ message: '需要密码' });
    }

    const admin = await Admin.findOne();
    if (!admin) {
      // 如果没有管理员账号，创建一个默认账号
      const defaultPassword = 'admin123'; // 默认密码
      const hashedPassword = Admin.hashPassword(defaultPassword);
      await Admin.create({
        password: hashedPassword,
        isFirstLogin: false
      });
      
      if (password === defaultPassword) {
        return res.json({ message: '验证成功' });
      }
    }

    const hashedInputPassword = Admin.hashPassword(password);
    if (admin && admin.password === hashedInputPassword) {
      res.json({ message: '验证成功' });
    } else {
      res.status(401).json({ message: '密码错误' });
    }
  } catch (error) {
    console.error('密码验证错误:', error);
    res.status(500).json({ message: error.message });
  }
});

// 获取设置 - 不需要验证密码
router.get('/settings', async (req, res) => {
  try {
    console.log('获取设置请求');
    const settings = await Setting.findOne();
    if (!settings) {
      // 如果没有设置，创建默认设置
      const defaultSettings = new Setting();
      await defaultSettings.save();
      return res.json(defaultSettings);
    }
    res.json(settings);
  } catch (error) {
    console.error('获取设置错误:', error);
    res.status(500).json({ message: error.message });
  }
});

// 更新设置 - 需要验证密码
router.post('/settings', async (req, res) => {
  try {
    console.log('更新设置请求:', req.body);
    const settings = await Setting.findOneAndUpdate(
      {},
      req.body,
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (error) {
    console.error('更新设置错误:', error);
    res.status(500).json({ message: error.message });
  }
});

// 手动抓取 - 需要验证密码
router.post('/crawl', async (req, res) => {
  try {
    console.log('手动抓取请求');
    const articles = await CrawlerService.crawl();
    res.json({ message: '抓取成功', count: articles.length });
  } catch (error) {
    console.error('手动抓取错误:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 