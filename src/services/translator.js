const { translate } = require('@vitalets/google-translate-api');
const Article = require('../models/Article');

// 添加延迟函数
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 翻译单篇文章
async function translateArticle(article) {
  try {
    console.log(`开始翻译文章: ${article.title}`);
    
    // 翻译标题、内容和摘要
    const [titleResult, contentResult, summaryResult] = await Promise.all([
      translate(article.title || '', { to: 'zh-CN' }),
      translate(article.content || '', { to: 'zh-CN' }),
      translate(article.summary || '', { to: 'zh-CN' })
    ]);

    // 立即更新数据库
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
    }).sort({ publishDate: -1 });  // 按发布日期排序
    
    console.log(`找到 ${untranslatedArticles.length} 篇需要翻译的文章`);

    // 分批处理，每批15篇
    const batchSize = 15;
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