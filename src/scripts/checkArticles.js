const mongoose = require('mongoose');
const Article = require('../models/Article');
require('dotenv').config();

async function checkArticles() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('\n============= 检查文章状态 =============');
    console.log('数据库连接成功');

    // 获取文章总数
    const totalCount = await Article.countDocuments();
    console.log(`\n文章总数: ${totalCount}`);

    // 按源统计文章数量
    const sourceStats = await Article.aggregate([
      {
        $group: {
          _id: '$source',
          count: { $sum: 1 }
        }
      }
    ]);

    console.log('\n各源文章数量:');
    sourceStats.forEach(stat => {
      console.log(`${stat._id}: ${stat.count} 篇`);
    });

    // 检查翻译状态
    const translatedCount = await Article.countDocuments({ isTranslated: true });
    console.log('\n翻译状态:');
    console.log(`已翻译: ${translatedCount} 篇`);
    console.log(`未翻译: ${totalCount - translatedCount} 篇`);

    // 获取最新的几篇文章
    const latestArticles = await Article.find()
      .sort({ publishDate: -1 })
      .limit(5)
      .select('title translatedTitle source publishDate');

    console.log('\n最新文章:');
    latestArticles.forEach((article, index) => {
      console.log(`\n[${index + 1}] ${article.source}`);
      console.log('标题:', article.translatedTitle || article.title);
      console.log('发布时间:', article.publishDate);
    });

    await mongoose.disconnect();
    console.log('\n数据库连接已关闭');
  } catch (error) {
    console.error('检查失败:', error);
    process.exit(1);
  }
}

checkArticles(); 