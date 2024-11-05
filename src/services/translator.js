const { translate } = require('@vitalets/google-translate-api');
const Article = require('../models/Article');

// 添加延迟函数
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 添加重试翻译函数
async function retryTranslate(text, retries = 3) {
  if (!text) return { text: '' };
  
  for (let i = 0; i < retries; i++) {
    try {
      // 每次重试前添加延迟
      if (i > 0) {
        await delay(2000 * i);
      }
      return await translate(text, { to: 'zh-CN' });
    } catch (error) {
      console.error(`翻译失败 (尝试 ${i + 1}/${retries}):`, error.message);
      if (i === retries - 1) {
        // 最后一次尝试失败，返回原文
        return { text };
      }
    }
  }
}

// 翻译单篇文章
async function translateArticle(article) {
  try {
    console.log(`开始翻译文章: ${article.title}`);
    console.log('内容长度:', {
      title: article.title?.length || 0,
      content: article.content?.length || 0,
      summary: article.summary?.length || 0
    });
    
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
      title: updatedArticle.translatedTitle
    });

    return true;
  } catch (error) {
    console.error(`翻译文章失败: ${article.title}`, error);
    return false;
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
    }).sort({ publishDate: -1 });
    
    console.log(`找到 ${untranslatedArticles.length} 篇需要翻译的文章`);

    // 分批处理，每批5篇
    const batchSize = 5;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < untranslatedArticles.length; i += batchSize) {
      const batch = untranslatedArticles.slice(i, i + batchSize);
      console.log(`\n开始处理第 ${i + 1} 到 ${i + batch.length} 篇文章`);

      // 逐个处理每篇文章
      for (const article of batch) {
        const success = await translateArticle(article);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
        // 每篇文章之间添加延迟
        await delay(3000);
      }

      console.log(`\n当前批次处理完成`);
      console.log(`成功: ${successCount} 篇`);
      console.log(`失败: ${failCount} 篇`);
      
      // 每批之间添加较长延迟
      if (i + batchSize < untranslatedArticles.length) {
        console.log('等待下一批处理...');
        await delay(10000);
      }
    }

    console.log('\n翻译任务完成');
    console.log(`总成功: ${successCount} 篇`);
    console.log(`总失败: ${failCount} 篇`);

  } catch (error) {
    console.error('翻译过程失败:', error);
  }
}

module.exports = {
  translateUntranslatedArticles
}; 