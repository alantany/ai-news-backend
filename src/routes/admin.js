const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Setting = require('../models/Setting');
const CrawlerService = require('../services/crawler');

// 中间件：验证管理员密码
const verifyPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
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
    res.status(500).json({ message: error.message });
  }
};

// 初始化或更改密码
router.post('/password', async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ message: '密码不能为空' });
    }

    const admin = await Admin.findOne();

    if (!admin || admin.isFirstLogin) {
      const hashedPassword = Admin.hashPassword(password);

      if (admin) {
        await admin.update({
          password: hashedPassword,
          isFirstLogin: false
        });
      } else {
        await Admin.create({
          password: hashedPassword,
          isFirstLogin: false
        });
      }
      res.json({ message: '密码设置成功' });
    } else {
      res.status(403).json({ message: '密码已经设置过' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 获取设置
router.get('/settings', verifyPassword, async (req, res) => {
  try {
    const settings = await Setting.findOne();
    res.json(settings || {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 更新设置
router.post('/settings', verifyPassword, async (req, res) => {
  try {
    const settings = await Setting.findOneAndUpdate(
      {},
      req.body,
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 