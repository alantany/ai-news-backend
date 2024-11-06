const { translate } = require('@vitalets/google-translate-api');
const Article = require('../models/Article');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retryTranslate(text, retries = 3) {
  if (!text) return { text: '' };
  
  const cleanText = text
    .replace(/\n\s+/g, ' ')  // 替换换行+空格为单个空格
    .replace(/\s+/g, ' ')    // 替换多个空格为单个空格
    .trim();                 // 去除首尾空格
  
  for (let i = 0; i < retries; i++) {
    try {
      if (i > 0) {
        await delay(2000 * i);
      }
      
      if (!cleanText) {
        console.error('[translator] 清理后文本为空:', {
          原文长度: text.length,
          原文前30字符: text.substring(0, 30)
        });
        return { text: '' };
      }
      
      const result = await translate(cleanText, { to: 'zh-CN' });
      
      if (!result || !result.text) {
        throw new Error('翻译API返回结果为空');
      }
      
      console.log('[translator] 翻译成功:', {
        原文前30字符: cleanText.substring(0, 30),
        译文前30字符: result.text.substring(0, 30)
      });
      
      return result;
    } catch (error) {
      console.error('[translator] 翻译失败:', {
        尝试次数: `${i + 1}/${retries}`,
        错误类型: error.constructor.name,
        错误信息: error.message,
        原文前50字符: text.substring(0, 50),
        清理后前50字符: cleanText.substring(0, 50),
        API响应: error.response || '无响应信息'
      });
      
      if (i === retries - 1) {
        throw new Error(`翻译失败: ${error.message}`);
      }
    }
  }
}

async function translateUntranslatedArticles() {
  try {
    console.log('\n============= 开始翻译未翻译文章 =============');
    const startTime = new Date();
    
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

    let successCount = 0;
    let failCount = 0;
    let translatedTitles = [];

    for (const article of untranslatedArticles) {
      try {
        console.log(`\n[文章 ${successCount + failCount + 1}] 开始翻译:`, article.title);
        
        // 分别翻译并检查每个部分
        const titleResult = await retryTranslate(article.title || '');
        if (!titleResult.text) {
          throw new Error('标题翻译为空');
        }

        const contentResult = await retryTranslate(article.content || '');
        if (!contentResult.text) {
          throw new Error('内容翻译为空');
        }

        const summaryResult = await retryTranslate(article.summary || '');
        if (!summaryResult.text) {
          throw new Error('摘要翻译为空');
        }

        // 更新文章
        const updatedArticle = await Article.findByIdAndUpdate(
          article._id,
          {
            $set: {
              translatedTitle: titleResult.text,
              translatedContent: contentResult.text,
              translatedSummary: summaryResult.text,
              isTranslated: true,
              lastTranslated: new Date()
            }
          },
          { new: true }
        );

        successCount++;
        translatedTitles.push(titleResult.text);
        console.log(`[translator] 文章翻译完成 (${successCount}/${untranslatedArticles.length})`);
        
        await delay(3000);
      } catch (error) {
        console.error(`[translator] 文章翻译失败:`, {
          标题: article.title,
          错误: error.message
        });
        failCount++;
        return {
          success: successCount,
          failed: failCount,
          error: error.message,
          translatedArticles: translatedTitles
        };
      }
    }

    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;
    
    console.log('\n============= 翻译任务完成 =============');
    console.log(`总耗时: ${duration.toFixed(1)} 秒`);
    console.log(`成功: ${successCount} 篇`);
    console.log(`失败: ${failCount} 篇`);

    return {
      success: successCount,
      failed: failCount,
      duration: duration.toFixed(1),
      translatedArticles: translatedTitles
    };
  } catch (error) {
    console.error('[translator] 翻译过程失败:', error);
    return {
      success: 0,
      failed: 1,
      error: error.message,
      translatedArticles: []
    };
  }
}

module.exports = {
  translateUntranslatedArticles
}; 