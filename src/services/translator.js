const { translate } = require('@vitalets/google-translate-api');
const Article = require('../models/Article');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function retryTranslate(text, retries = 3) {
  if (!text) return { text: '' };
  
  const cleanText = text
    .replace(/\n\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  try {
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
    
    if (result.text === cleanText) {
      throw new Error('翻译结果与原文相同');
    }
    
    if (!/[\u4e00-\u9fa5]/.test(result.text)) {
      throw new Error('翻译结果不包含中文字符');
    }
    
    console.log('[translator] 翻译成功:', {
      原文前30字符: cleanText.substring(0, 30),
      译文前30字符: result.text.substring(0, 30)
    });
    
    return result;
  } catch (error) {
    // 如果是请求过多错误，直接抛出，不重试
    if (error.constructor.name === 'TooManyRequestsError') {
      console.error('[translator] API 请求次数超限:', {
        错误类型: error.constructor.name,
        错误信息: error.message
      });
      throw error;  // 直接抛出错误，不重试
    }
    
    // 其他错误记录日志
    console.error('[translator] 翻译失败:', {
      错误类型: error.constructor.name,
      错误信息: error.message,
      原文前50字符: text.substring(0, 50)
    });
    throw error;
  }
}

async function translateUntranslatedArticles() {
  try {
    console.log('\n============= 开始翻译未翻译文章 =============');
    const startTime = new Date();
    
    // 先获取总文章数
    const totalArticles = await Article.countDocuments();
    const translatedArticles = await Article.countDocuments({ isTranslated: true });
    
    console.log('文章统计:', {
      总文章数: totalArticles,
      已翻译: translatedArticles,
      未翻译: totalArticles - translatedArticles
    });
    
    // 查找未翻译的文章
    const untranslatedArticles = await Article.find({
      $or: [
        { isTranslated: { $ne: true } },
        { isTranslated: { $exists: false } },
        { translatedTitle: null },
        { translatedTitle: { $exists: false } },
        {
          $expr: {
            $eq: ["$title", "$translatedTitle"]
          }
        }
      ]
    }).sort({ publishDate: -1 });
    
    console.log('查询结果:', {
      查询条件: '未翻译或标题未翻译',
      找到文章数: untranslatedArticles.length,
      最新文章: untranslatedArticles[0] ? {
        标题: untranslatedArticles[0].title,
        发布时间: untranslatedArticles[0].publishDate,
        来源: untranslatedArticles[0].source
      } : '无'
    });

    let successCount = 0;
    let failCount = 0;
    let translatedTitles = [];

    for (const article of untranslatedArticles) {
      try {
        console.log(`\n[文章 ${successCount + failCount + 1}] 开始翻译:`, article.title);
        
        // 只检查标题翻译
        const titleResult = await retryTranslate(article.title || '');
        if (!titleResult.text) {
          throw new Error('标题翻译为空');
        }

        // 内容和摘要都允许为空
        const contentResult = await retryTranslate(article.content || '');
        const summaryResult = await retryTranslate(article.summary || '');
        
        // 更新文章，内容和摘要允许为空
        const updatedArticle = await Article.findByIdAndUpdate(
          article._id,
          {
            $set: {
              translatedTitle: titleResult.text,
              translatedContent: contentResult.text || '',
              translatedSummary: summaryResult.text || '',
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
        
        // 只有标题翻译失败时才终止流程
        if (error.message === '标题翻译为空') {
          return {
            success: successCount,
            failed: failCount,
            error: error.message,
            translatedArticles: translatedTitles
          };
        }
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