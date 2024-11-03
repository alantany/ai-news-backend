const mongoose = require('mongoose');
const Article = require('../models/Article');
require('dotenv').config();

async function checkArticles() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('数据库连接成功');

    // 检查文章总数
    const count = await Article.countDocuments();
    console.log(`数据库中共有 ${count} 篇文章`);

    // 获取所有文章的基本信息
    const articles = await Article.find({}, 'title translatedTitle source publishDate');
    console.log('\n文章列表:');
    articles.forEach((article, index) => {
      console.log(`\n[${index + 1}] ${article.source}`);
      console.log('标题:', article.title);
      console.log('翻译标题:', article.translatedTitle);
      console.log('发布日期:', article.publishDate);
    });

    mongoose.disconnect();
  } catch (error) {
    console.error('检查失败:', error);
    process.exit(1);
  }
}

checkArticles(); 