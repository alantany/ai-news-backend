const mongoose = require('mongoose');
const Article = require('../models/Article');
require('dotenv').config();

async function checkTitles() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('\n============= 检查文章标题状态 =============');
    console.log('数据库连接成功');

    const articles = await Article.find({}, 'title translatedTitle source');
    console.log(`\n共找到 ${articles.length} 篇文章\n`);
    
    articles.forEach((article, index) => {
      console.log(`[${index + 1}] ${article.source}`);
      console.log('原始标题:', article.title);
      console.log('翻译标题:', article.translatedTitle || '未翻译');
      console.log('翻译状态:', article.translatedTitle ? '已翻译' : '未翻译');
      console.log('------------------------');
    });

    // 统计信息
    const translatedCount = articles.filter(a => a.translatedTitle).length;
    console.log('\n统计信息:');
    console.log(`总文章数: ${articles.length}`);
    console.log(`已翻译标题: ${translatedCount}`);
    console.log(`未翻译标题: ${articles.length - translatedCount}`);

    await mongoose.disconnect();
    console.log('\n数据库连接已关闭');
  } catch (error) {
    console.error('检查失败:', error);
    process.exit(1);
  }
}

checkTitles();