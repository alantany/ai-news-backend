const { translate } = require('@vitalets/google-translate-api');
const Article = require('../models/Article');

// 添加延迟函数
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 添加重试翻译函数
async function retryTranslate(text, retries = 3) {
  if (!text) return { text: '' };
  
  for (let i = 0; i < retries; i++) {
    try {
      if (i > 0) {
        await delay(2000 * i);
      }
      return await translate(text, { to: 'zh-CN' });
    } catch (error) {
      console.error(`翻译失败 (尝试 ${i + 1}/${retries}):`, error.message);
      if (i === retries - 1) throw error;
    }
  }
}

async function translateUntranslatedArticles() {
  try {
    console.log('\n============= 开始翻译未翻译文章 =============');
    
    const untranslatedArticles = await Article.find({
      $or: [
        { translatedTitle: { $exists: false } },
        { translatedContent: { $exists: false } },
        { translatedSummary: { $exists: false } },
        { translatedTitle: null },
        { translatedContent: null },
        { translatedSummary: null }
      ]
    });
    
    console.log(`找到 ${untranslatedArticles.length} 篇需要翻译的文章`);

    for (const article of untranslatedArticles) {
      try {
        console.log(`开始翻译文章: ${article.title}`);
        console.log('内容长度:', {
          title: article.title?.length || 0,
          content: article.content?.length || 0,
          summary: article.summary?.length || 0
        });
        
        if (!article.content) {
          console.log('警告: 文章内容为空');
        }
        if (!article.summary) {
          console.log('警告: 文章摘要为空');
        }

        // 使用重试机制翻译
        const [titleResult, contentResult, summaryResult] = await Promise.all([
          retryTranslate(article.title || ''),
          retryTranslate(article.content || ''),
          retryTranslate(article.summary || '')
        ]);

        // 更新文章
        const updatedArticle = await Article.findByIdAndUpdate(
          article._id,
          {
            $set: {
              translatedTitle: titleResult.text,
              translatedContent: contentResult.text,
              translatedSummary: summaryResult.text,
              isTranslated: true
            }
          },
          { new: true }
        );

        console.log('文章翻译成功:', {
          id: updatedArticle._id,
          hasTranslatedTitle: !!updatedArticle.translatedTitle,
          hasTranslatedContent: !!updatedArticle.translatedContent,
          hasTranslatedSummary: !!updatedArticle.translatedSummary
        });

        await delay(3000);
      } catch (error) {
        console.error(`翻译文章失败: ${article.title}`, error);
        console.error('错误详情:', {
          message: error.message,
          stack: error.stack
        });
        continue;
      }
    }

  } catch (error) {
    console.error('翻译过程失败:', error);
  }
}

module.exports = {
  translateUntranslatedArticles
}; 