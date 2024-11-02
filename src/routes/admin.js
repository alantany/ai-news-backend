const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Setting = require('../models/Setting');
const CrawlerService = require('../services/crawler');

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

// 手动抓取
router.post('/crawl', async (req, res) => {
  try {
    console.log('手动抓取请求');
    const crawler = new CrawlerService();
    const articles = await crawler.crawl();
    res.json({ message: '抓取成功', count: articles.length });
  } catch (error) {
    console.error('手动抓取错误:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 