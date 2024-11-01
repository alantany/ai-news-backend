const mongoose = require('mongoose');
const Article = require('../models/Article');
require('dotenv').config();

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // 清除现有数据
    await Article.deleteMany({});

    // 插入测试数据
    const articles = await Article.insertMany([
      {
        title: 'ChatGPT 最新更新：支持图像理解',
        content: 'OpenAI 今日宣布 ChatGPT 新增图像理解功能，用户现在可以向 ChatGPT 展示图片并进行相关讨论...',
        source: 'OpenAI Blog',
        url: 'https://openai.com/blog/chatgpt-image',
        publishDate: new Date(),
        category: 'AI'
      },
      {
        title: 'Google 发布新一代 AI 模型',
        content: 'Google 今日发布了新一代 AI 模型，该模型在多个基准测试中都取得了突破性进展...',
        source: 'Google AI Blog',
        url: 'https://ai.google/blog/new-model',
        publishDate: new Date(),
        category: 'AI'
      }
      // 可以添加更多测试数据
    ]);

    console.log('测试数据添加成功');
    process.exit(0);
  } catch (error) {
    console.error('添加测试数据失败:', error);
    process.exit(1);
  }
};

seedData(); 