const { translate } = require('@vitalets/google-translate-api');
const Article = require('../models/Article');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retryTranslate(text, retries = 3) {
  if (!text) return { text: '' };
  
  for (let i = 0; i < retries; i++) {
    try {
      if (i > 0) {
        await delay(2000 * i);
      }
      return await translate(text, { to: 'zh-CN' });
    } catch (error) {
      console.error(`翻译失败 (尝试 ${i + 1}/${retries}):`, {
        error: error.message,
        type: error.constructor.name
      });
      
      if (error.message === 'Method Not Allowed') {
        throw new Error('翻译服务暂时不可用，请稍后重试');
      }
      
      if (i === retries - 1) {
        throw error;
      }
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
    }).sort({ publishDate: -1 });
    
    console.log(`找到 ${untranslatedArticles.length} 篇需要翻译的文章`);

    const batchSize = 5;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < untranslatedArticles.length; i += batchSize) {
      const batch = untranslatedArticles.slice(i, i + batchSize);
      console.log(`\n开始处理第 ${i + 1} 到 ${i + batch.length} 篇文章`);

      try {
        for (const article of batch) {
          try {
            console.log(`\n[文章 ${successCount + failCount + 1}] 开始翻译:`, article.title);
            
            const [titleResult, contentResult, summaryResult] = await Promise.all([
              retryTranslate(article.title || ''),
              retryTranslate(article.content || ''),
              retryTranslate(article.summary || '')
            ]);

            console.log('翻译完成，准备保存...');
            console.log('标题翻译:', titleResult.text.substring(0, 100));
            console.log('摘要翻译:', summaryResult.text.substring(0, 100));
            console.log('正文长度:', contentResult.text.length);

            // 更新文章
            const updatedArticle = await Article.findByIdAndUpdate(
              article._id,
              {
                $set: {
                  translatedTitle: titleResult.text,
                  translatedContent: contentResult.text,
                  translatedSummary: summaryResult.text,
                  isTranslated: true,
                  lastTranslated: new Date()  // 添加翻译时间
                }
              },
              { new: true }
            );

            console.log('保存成功:', {
              id: updatedArticle._id,
              title: updatedArticle.translatedTitle,
              saveTime: new Date().toISOString(),
              contentLength: updatedArticle.translatedContent.length,
              summaryLength: updatedArticle.translatedSummary.length
            });

            successCount++;
            console.log(`当前进度: 成功 ${successCount} 篇，失败 ${failCount} 篇`);
            
            await delay(3000);
          } catch (error) {
            console.error(`翻译文章失败: ${article.title}`, {
              error: error.message,
              time: new Date().toISOString()
            });
            failCount++;
            
            if (error.message === '翻译服务暂时不可用，请稍后重试') {
              console.log('翻译服务不可用，停止翻译过程');
              return;
            }
          }
        }

        if (i + batchSize < untranslatedArticles.length) {
          console.log('\n等待下一批处理...');
          await delay(10000);
        }
      } catch (error) {
        console.error('批次处理失败:', error);
        break;
      }
    }

    console.log('\n============= 翻译任务完成 =============');
    console.log('总统计:');
    console.log(`- 成功: ${successCount} 篇`);
    console.log(`- 失败: ${failCount} 篇`);
    console.log(`- 完成时间: ${new Date().toISOString()}`);

  } catch (error) {
    console.error('翻译过程失败:', error);
  }
}

module.exports = {
  translateUntranslatedArticles
}; 