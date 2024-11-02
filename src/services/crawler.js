const Parser = require('rss-parser');
const Article = require('../models/Article');
const { OpenAI } = require('openai');
const Setting = require('../models/Setting');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

class CrawlerService {
  constructor() {
    this.parser = new Parser({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 10000,
      maxRedirects: 5
    });

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.BASE_URL
    });

    this.rssSources = [
      {
        name: 'Towards Data Science',
        url: 'https://towardsdatascience.com/feed'
      },
      {
        name: 'Microsoft AI Blog',
        url: 'https://blogs.microsoft.com/ai/feed/'
      },
      {
        name: 'TechCrunch AI',
        url: 'https://techcrunch.com/tag/artificial-intelligence/feed/'
      },
      {
        name: 'VentureBeat AI',
        url: 'https://venturebeat.com/category/ai/feed/'
      }
    ];

    // 定义文章类型及其关键词权重
    this.articleCategories = {
      RAG: {
        weight: 100,
        keywords: [
          'RAG',
          'Retrieval Augmented Generation',
          'Retrieval-Augmented',
          'Vector Database',
          'Knowledge Base',
          'Document Retrieval'
        ]
      },
      LLM_DEV: {
        weight: 80,
        keywords: [
          'Fine-tuning',
          'Training',
          'Model Development',
          'LLM Architecture',
          'Prompt Engineering',
          'Model Optimization'
        ]
      },
      LLM_NEWS: {
        weight: 60,
        keywords: [
          'GPT',
          'Claude',
          'Gemini',
          'LLaMA',
          'Large Language Model',
          'Foundation Model'
        ]
      },
      GENERAL_AI: {
        weight: 40,
        keywords: [
          'Artificial Intelligence',
          'Machine Learning',
          'Deep Learning',
          'Neural Network',
          'AI Application'
        ]
      }
    };

    this.BAIDU_APP_ID = process.env.BAIDU_APP_ID;
    this.BAIDU_SECRET = process.env.BAIDU_SECRET;
  }

  calculateArticleScore(title, content) {
    let maxScore = 0;
    let category = 'GENERAL_AI';

    // 将标题和内容合并为一个文本进行检索
    const text = `${title} ${content}`.toLowerCase();

    // 遍历每个分类的关键词
    for (const [cat, config] of Object.entries(this.articleCategories)) {
      for (const keyword of config.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          const score = config.weight;
          if (score > maxScore) {
            maxScore = score;
            category = cat;
          }
        }
      }
    }

    return {
      score: maxScore,
      category
    };
  }

  async fetchFullContent(url) {
    try {
      console.log('尝试获取完整文章内容:', url);
      const response = await fetch(url);
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Medium 文章的主要内容通常在 article 标签内
      let content = $('article').text();
      
      // 如果找不到 article 标签，尝试其他选择器
      if (!content) {
        content = $('.story-content').text() || 
                 $('.article-content').text() || 
                 $('main').text();
      }
      
      return content;
    } catch (error) {
      console.error('获取完整内容失败:', error);
      return null;
    }
  }

  cleanHtmlContent(content) {
    if (!content) return '';
    
    try {
      // 移除所有 HTML 标签
      let cleanText = content.replace(/<[^>]*>/g, ' ');
      
      // 移除多余的空格
      cleanText = cleanText.replace(/\s+/g, ' ');
      
      // 移除 Medium 特有的链接文本
      cleanText = cleanText.replace(/Continue reading on.*?»/, '');
      cleanText = cleanText.replace(/Towards Data Science.*?»/, '');
      
      // 移除图片链接
      cleanText = cleanText.replace(/https:\/\/cdn-images-.*?\s/g, '');
      
      // 处理特殊字符
      cleanText = cleanText.replace(/&nbsp;/g, ' ');
      cleanText = cleanText.replace(/&amp;/g, '&');
      cleanText = cleanText.replace(/&lt;/g, '<');
      cleanText = cleanText.replace(/&gt;/g, '>');
      
      return cleanText.trim();
    } catch (error) {
      console.error('清理HTML内容失败:', error);
      return content;
    }
  }

  async crawl() {
    try {
      console.log('开始抓取文章...');
      let allArticles = [];

      for (const source of this.rssSources) {
        try {
          console.log(`\n正在从 ${source.name} 抓取...`);
          const feed = await this.parser.parseURL(source.url);
          
          for (const item of feed.items) {
            // 对 Medium 文章进行特殊处理
            if (item.link && item.link.includes('towardsdatascience.com')) {
              console.log('检测到 Medium 文章，获取完整内容:', item.link);
              
              // 首先尝试获取完整内容
              let content = '';
              try {
                content = await this.fetchFullContent(item.link);
                console.log('获取到完整内容长度:', content ? content.length : 0);
              } catch (error) {
                console.error('获取完整内容失败，使用RSS内容:', error);
                content = item.content || item.contentSnippet || item.description || '';
              }

              // 清理内容
              content = this.cleanHtmlContent(content);
              
              // 如果内容太短，使用RSS中的内容作为备选
              if (!content || content.length < 500) {
                console.log('获取的内容太短，使用RSS内容');
                const rssContent = item.content || item.contentSnippet || item.description || '';
                content = this.cleanHtmlContent(rssContent);
              }

              console.log('\n=================== 文章详情 ===================');
              console.log('标题:', item.title);
              console.log('内容长度:', content.length);
              console.log('处理后的内容:\n', content);
              console.log('===============================================\n');

              const { score, category } = this.calculateArticleScore(
                item.title || '',
                content
              );

              allArticles.push({
                title: item.title || '',
                content: content,
                link: item.link,
                pubDate: item.pubDate || item.isoDate,
                score,
                category,
                source: source.name
              });
            }
          }
        } catch (error) {
          console.error(`从 ${source.name} 抓取失败:`, error);
          continue;
        }
      }

      // 按分数排序并只取前5篇
      const selectedArticles = allArticles
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // 翻译并保存选中的文章
      const savedArticles = [];
      for (const article of selectedArticles) {
        try {
          const existingArticle = await Article.findOne({ url: article.link });
          if (!existingArticle) {
            console.log('\n=============== 开始翻译文章 ===============');
            console.log('原文标题:', article.title);
            console.log('原文内容:\n', article.content);

            const translatedTitle = await this.translateText(article.title);
            const translatedContent = await this.translateText(article.content);
            const summary = this.generateSummary(article.content);
            const translatedSummary = await this.translateText(summary);

            console.log('\n=============== 翻译结果 ===============');
            console.log('翻译后标题:', translatedTitle);
            console.log('翻译后内容:\n', translatedContent);
            console.log('翻译后摘要:\n', translatedSummary);
            console.log('=========================================\n');

            const savedArticle = await Article.create({
              title: translatedTitle,
              content: translatedContent,
              summary: translatedSummary,
              source: article.source,
              url: article.link,
              publishDate: new Date(article.pubDate),
              category: article.category
            });

            console.log(`保存新文章: ${translatedTitle} (${article.category})`);
            savedArticles.push(savedArticle);
          } else {
            console.log(`文章已存在，跳过: ${article.title}`);
          }
        } catch (error) {
          console.error(`文章处理失败:`, error);
          continue;
        }
      }

      console.log(`\n本次抓取完成，成功保存 ${savedArticles.length} 篇文章`);
      return savedArticles;
    } catch (error) {
      console.error('抓取文章失败:', error);
      throw error;
    }
  }

  generateSummary(content) {
    if (!content) return '';
    const plainText = content.replace(/<[^>]*>/g, '');
    return plainText.substring(0, 200) + '...';
  }

  async translateText(text) {
    if (!text) return '';
    
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo-16k",
        messages: [
          {
            role: "system",
            content: "你是一个专业的翻译器。请直接将英文内容翻译成中文，保持原文的完整性，不要总结或改写。保留专业术语的准确性。"
          },
          {
            role: "user",
            content: `请将以下内容完整翻译成中文：\n${text}`
          }
        ],
        temperature: 0.3,
        max_tokens: 4000
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('翻译失败:', error);
      
      // 如果内容太长，尝试分段翻译
      if (error.message.includes('maximum context length')) {
        console.log('内容太长，尝试分段翻译');
        const segments = this.splitTextIntoSegments(text, 3000);
        const translatedSegments = await Promise.all(
          segments.map(segment => this.translateText(segment))
        );
        return translatedSegments.join('\n');
      }
      
      throw error;
    }
  }

  // 添加分段方法
  splitTextIntoSegments(text, maxLength) {
    const segments = [];
    let currentSegment = '';
    
    // 按句子分割
    const sentences = text.split(/(?<=[.!?])\s+/);
    
    for (const sentence of sentences) {
      if ((currentSegment + sentence).length > maxLength) {
        segments.push(currentSegment);
        currentSegment = sentence;
      } else {
        currentSegment += (currentSegment ? ' ' : '') + sentence;
      }
    }
    
    if (currentSegment) {
      segments.push(currentSegment);
    }
    
    return segments;
  }
}

module.exports = CrawlerService;