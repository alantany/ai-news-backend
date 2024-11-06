const Article = require('../models/Article');

async function cleanOldArticles() {
  try {
    // 保留最近3个月的文章
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const result = await Article.deleteMany({
      publishDate: { $lt: threeMonthsAgo }
    });
    
    console.log(`清理了 ${result.deletedCount} 篇3个月前的文章`);
    return result.deletedCount;
  } catch (error) {
    console.error('清理旧文章失败:', error);
    throw error;
  }
}

module.exports = {
  cleanOldArticles
}; 