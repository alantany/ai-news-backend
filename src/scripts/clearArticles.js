const mongoose = require('mongoose');
const Article = require('../models/Article');
require('dotenv').config();

const clearArticles = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('连接数据库成功');
    
    const result = await Article.deleteMany({});
    console.log(`清理完成，共删除 ${result.deletedCount} 篇文章`);
    
    process.exit(0);
  } catch (error) {
    console.error('清理数据失败:', error);
    process.exit(1);
  }
};

clearArticles(); 