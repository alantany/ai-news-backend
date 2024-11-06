const mongoose = require('mongoose');
const Article = require('../models/Article');
require('dotenv').config();

async function checkStats() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('\n============= 检查文章统计数据 =============');
    console.log('数据库连接成功');

    const articles = await Article.find({});
    console.log(`\n总文章数: ${articles.length}`);

    // 检查每篇文章的统计数据
    articles.forEach((article, index) => {
      console.log(`\n[${index + 1}] ${article.title}`);
      console.log('点赞数:', article.likes || 0);
      console.log('阅读数:', article.reads || 0);
      console.log('收藏数:', article.stars || 0);
      console.log('分享数:', article.shares || 0);
    });

    // 计算总数
    const stats = {
      totalLikes: articles.reduce((sum, a) => sum + (a.likes || 0), 0),
      totalReads: articles.reduce((sum, a) => sum + (a.reads || 0), 0),
      totalStars: articles.reduce((sum, a) => sum + (a.stars || 0), 0),
      totalShares: articles.reduce((sum, a) => sum + (a.shares || 0), 0)
    };

    console.log('\n总计:');
    console.log('总点赞数:', stats.totalLikes);
    console.log('总阅读数:', stats.totalReads);
    console.log('总收藏数:', stats.totalStars);
    console.log('总分享数:', stats.totalShares);

    await mongoose.disconnect();
  } catch (error) {
    console.error('检查失败:', error);
    process.exit(1);
  }
}

checkStats(); 