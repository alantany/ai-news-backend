const mongoose = require('mongoose');
const Article = require('../models/Article');
require('dotenv').config();

async function checkArticles() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('数据库连接成功');

    // 获取一篇文章的完整内容
    const article = await Article.findOne();
    
    if (article) {
      console.log('\n============= 文章内容检查 =============');
      console.log('标题:', article.title);
      console.log('来源:', article.source);
      console.log('\n原文内容预览:');
      console.log(article.content.substring(0, 500) + '...');
      
      console.log('\n内容分析:');
      console.log('总长度:', article.content.length);
      console.log('换行符数量:', (article.content.match(/\n/g) || []).length);
      console.log('段落数量:', article.content.split('\n\n').length);
      
      // 检查格式标记
      console.log('\n格式标记:');
      const headings = article.content.match(/###[^#\n]*/g) || [];
      console.log('标题数量:', headings.length);
      if (headings.length > 0) {
        console.log('标题示例:', headings.slice(0, 3));
      }
    } else {
      console.log('数据库中没有文章');
    }

    mongoose.disconnect();
  } catch (error) {
    console.error('检查失败:', error);
    process.exit(1);
  }
}

checkArticles(); 