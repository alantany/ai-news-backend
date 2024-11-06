const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // 5分钟缓存

function getCacheKey(page, limit) {
  return `articles_${page}_${limit}`;
}

async function getArticlesWithCache(page, limit) {
  const cacheKey = getCacheKey(page, limit);
  const cached = cache.get(cacheKey);
  
  if (cached) {
    return cached;
  }
  
  // 从数据库获取数据
  const articles = await Article.find(
    {}, 
    'title translatedTitle summary translatedSummary publishDate source isTranslated'
  )
  .sort({ publishDate: -1 })
  .skip((page - 1) * limit)
  .limit(limit)
  .lean();
  
  // 设置缓存
  cache.set(cacheKey, articles);
  
  return articles;
} 