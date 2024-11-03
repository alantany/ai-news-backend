const Parser = require('rss-parser');
const { OpenAI } = require('openai');
const Article = require('../models/Article');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const Setting = require('../models/Setting');
const { translate } = require('@vitalets/google-translate-api');
const md5 = require('md5');

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

    this.initializeCategories();

    // 百度翻译配置
    this.BAIDU_APP_ID = '20241103002193055';
    this.BAIDU_SECRET = 'SHHg4TWXNo_HXA2jfso3';
  }

  initializeCategories() {
    console.log('初始化文章分类配置');
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
    console.log('分类配置初始化完成');
  }

  async loadRssSources() {
    try {
      const rssListPath = path.join(__dirname, '../../rss_list.txt');
      const content = await fs.readFile(rssListPath, 'utf-8');
      const urls = content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')); // 忽略空行和注释

      console.log('加载RSS源:', urls);
      
      this.rssSources = urls.map(url => ({
        name: this.getRssSourceName(url),
        url: url
      }));
    } catch (error) {
      console.error('加载RSS源失败:', error);
      // 使默认值
      this.rssSources = [{
        name: 'Towards Data Science',
        url: 'https://towardsdatascience.com/feed'
      }];
    }
  }

  getRssSourceName(url) {
    if (url.includes('towardsdatascience.com')) return 'Towards Data Science';
    if (url.includes('blogs.microsoft.com')) return 'Microsoft AI Blog';
    if (url.includes('techcrunch.com')) return 'TechCrunch AI';
    return new URL(url).hostname;
  }

  calculateArticleScore(title = '', source = '') {
    const titleLower = title.toLowerCase();
    let baseScore = 0;
    let category = 'GENERAL_AI';
    
    // RAG 相关 (最高优先级)
    if (titleLower.includes('rag') || 
        titleLower.includes('retrieval') ||
        titleLower.includes('vector') ||
        titleLower.includes('embedding') ||
        titleLower.includes('knowledge base')) {
      baseScore = 100;
      category = 'RAG';
    }
    // LLM 开发相关 (次高优先级)
    else if (titleLower.includes('llm') || 
        titleLower.includes('fine-tun') ||
        titleLower.includes('train') ||
        titleLower.includes('prompt') ||
        titleLower.includes('model') ||
        titleLower.includes('neural') ||
        titleLower.includes('transformer')) {
      baseScore = 80;
      category = 'LLM_DEV';
    }
    // LLM 通用技术 (中等优先级)
    else if (titleLower.includes('gpt') || 
        titleLower.includes('claude') ||
        titleLower.includes('gemini') ||
        titleLower.includes('llama') ||
        titleLower.includes('language model') ||
        titleLower.includes('chat') ||
        titleLower.includes('foundation model')) {
      baseScore = 60;
      category = 'LLM_NEWS';
    }
    // AI 通用 (最低优先级)
    else {
      baseScore = 40;
      category = 'GENERAL_AI';
    }

    // 来源权重
    let sourceBonus = 0;
    if (source.includes('microsoft')) {
      sourceBonus = 20;  // Microsoft 的文章加分
    } else if (source.includes('towardsdatascience')) {
      sourceBonus = 15;  // Medium 的文章加分
    } else if (source.includes('research.google')) {
      sourceBonus = 10;  // Google 的文章加分
    }

    return {
      score: baseScore + sourceBonus,
      category
    };
  }

  async crawl() {
    try {
      await this.loadRssSources();
      console.log('\n============= 开始抓取文章 =============');
      
      const settings = await Setting.findOne() || { preArticlesPerSource: 5 };
      const articlesPerSource = settings.preArticlesPerSource || 5;
      console.log(`每个源抓取数量: ${articlesPerSource}`);
      
      let allArticles = [];
      
      // 遍历所有 RSS 源
      for (const source of this.rssSources) {
        try {
          console.log(`\n抓取源: ${source.name}`);
          const feed = await this.parser.parseURL(source.url);
          
          // 获取每个源的前 N 篇文章
          const articles = feed.items
            .slice(0, articlesPerSource)
            .map(item => {
              const processedArticle = this.processRssItem(item, source);
              if (processedArticle) {
                const scoreResult = this.calculateArticleScore(processedArticle.title, source.name);
                return {
                  ...processedArticle,
                  score: scoreResult.score,
                  category: scoreResult.category
                };
              }
              return null;
            })
            .filter(article => article !== null);

          allArticles.push(...articles);
          console.log(`获取到 ${articles.length} 篇文章`);
        } catch (error) {
          console.error(`抓取失败: ${source.name}`, error);
          continue;
        }
      }

      console.log(`\n总共获取到 ${allArticles.length} 篇文章`);

      // 保存所有文章
      const savedArticles = [];
      for (const article of allArticles) {
        try {
          // 检查必要字段
          if (!article.title || !article.content || !article.link) {
            console.error('文章缺少必要字段:', {
              hasTitle: !!article.title,
              hasContent: !!article.content,
              hasLink: !!article.link
            });
            continue;
          }

          const existingArticle = await Article.findOne({ url: article.link });
          if (existingArticle) {
            console.log('已存在，跳过');
            continue;
          }

          const savedArticle = await Article.create({
            title: article.title,
            content: article.content,
            source: article.source,
            url: article.link,
            publishDate: new Date(article.pubDate),
            category: article.category,
            isTranslated: false
          });

          console.log('保存成功:', savedArticle.title);
          savedArticles.push(savedArticle);
        } catch (error) {
          console.error('保存失败，错误:', error.message);
          console.error('文章数据:', {
            title: article.title,
            source: article.source,
            hasContent: !!article.content,
            url: article.link
          });
          continue;
        }
      }

      console.log(`\n本次保存: ${savedArticles.length} 篇`);
      return savedArticles;
    } catch (error) {
      console.error('抓取失败:', error);
      throw error;
    }
  }

  async processRssItem(item, source) {
    try {
      const content = item.content || item.contentSnippet || item.description || '';
      const cleanContent = this.cleanHtmlContent(content);
      
      return {
        title: item.title,
        content: cleanContent,
        link: item.link,
        pubDate: item.pubDate,
        source: source.name
      };
    } catch (error) {
      console.error('处理文章失败');
      return null;
    }
  }

  async processMediumArticle(item) {
    console.log('处理 Medium 文章');
    try {
      // Medium 文章需要特殊处理
      let content = item.content || item.contentSnippet || item.description || '';
      content = this.cleanHtmlContent(content);
      
      // 如果内容太短，尝试获取完整内容
      if (content.length < 500 && item.link) {
        console.log('Medium 文章内容太短，尝试获取完整内容');
        const fullContent = await this.fetchFullContent(item.link, 'medium');
        if (fullContent && fullContent.length > content.length) {
          content = fullContent;
        }
      }
      
      return content;
    } catch (error) {
      console.error('处理 Medium 文章失败:', error);
      return null;
    }
  }

  async processMicrosoftArticle(item) {
    try {
      let content = item.content || item.description || '';
      content = this.cleanHtmlContent(content);
      
      if (content.length < 500 && item.link) {
        const fullContent = await this.fetchFullContent(item.link, 'microsoft');
        if (fullContent && fullContent.length > content.length) {
          content = fullContent;
        }
      }
      return content;
    } catch (error) {
      console.error('处理 Microsoft 文章失败');
      return null;
    }
  }

  async processTechCrunchArticle(item) {
    try {
      if (!item.link) {
        console.log('没有找到文章链接');
        return null;
      }

      console.log('从原文获取完整内容');
      const response = await fetch(item.link, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://techcrunch.com'
        }
      });

      const html = await response.text();
      const $ = cheerio.load(html);

      // 更新 TechCrunch 文章内容选择器
      const articleSelectors = [
        '.article-content',
        '.article__content',
        '.article-body',
        '.post-content',
        '#article-container',
        '.article__main',  // 新增
        'article p',       // 新增：获取所有段落
        '.content-section' // 新增
      ];

      let content = '';
      for (const selector of articleSelectors) {
        const elements = $(selector);
        if (elements.length > 0) {
          // 如果是段落选择器，合并所有段落
          if (selector === 'article p') {
            content = elements.map((i, el) => $(el).text()).get().join('\n\n');
          } else {
            content = elements.text();
          }
          console.log(`使用选择器 ${selector} 成功获取内容`);
          break;
        }
      }

      if (!content) {
        // 尝试获取所有文本内容
        content = $('article').text() || $('main').text();
      }

      if (!content) {
        console.log('无法获取文章内容');
        // 如果实获取不到，使用 RSS 中的描述
        content = item.content || item.description || '';
      }

      const cleanContent = this.cleanHtmlContent(content);
      
      // 检查清理后的内容是否足够长
      if (cleanContent.length < 100) {
        console.log('内容太短，可能未正确获取');
        return null;
      }

      return cleanContent;
    } catch (error) {
      console.error('处理 TechCrunch 文章失败:', error.message);
      return null;
    }
  }

  async processDefaultArticle(item) {
    console.log('使用默认处理方式');
    try {
      let content = item.content || item.contentSnippet || item.description || '';
      return this.cleanHtmlContent(content);
    } catch (error) {
      console.error('处理文章失败:', error);
      return null;
    }
  }

  async fetchFullContent(url, source = 'microsoft') {
    try {
      const response = await fetch(url);
      const html = await response.text();
      const $ = cheerio.load(html);
      
      if (source === 'microsoft') {
        return $('.article-content').text() || 
               $('.entry-content').text() || 
               $('main article').text() ||
               $('.post-content').text();
      }
      return null;
    } catch (error) {
      console.error('获取完整内容失败');
      return null;
    }
  }

  cleanHtmlContent(content) {
    if (!content) return '';
    
    try {
      const $ = cheerio.load(content);
      
      // 移除所有脚本和样式
      $('script, style').remove();
      
      // 处理段落
      $('p').each((i, elem) => {
        $(elem).after('\n\n');
      });
      
      // 处理标题
      $('h1, h2, h3, h4, h5, h6').each((i, elem) => {
        const text = $(elem).text().trim();
        $(elem).replaceWith(`\n\n${text}\n\n`);
      });
      
      // 处理列表
      $('ul, ol').each((i, elem) => {
        $(elem).find('li').each((i, li) => {
          $(li).prepend('• ');
          $(li).append('\n');
        });
      });

      // 获取处理后的文本
      let text = $.text();
      
      // 清理特殊字符和多余空白
      text = text
        .replace(/\[\s*\.\.\.\s*\]/g, '...') // 处理 [...] 格式
        .replace(/\s*\n\s*\n\s*\n+/g, '\n\n') // 多个空行转换为两个
        .replace(/\s+/g, ' ') // 多个空格转换为一个
        .replace(/\n +/g, '\n') // 行首空格
        .replace(/\t/g, '') // 移除制表符
        .trim();

      return text;
    } catch (error) {
      console.error('清理内容失败');
      return content;
    }
  }

  formatContent($) {
    // 移除所有内容相关的日志
    return $.text().trim();
  }

  generateSummary(content) {
    // 简单地截取前200个字符作为摘要
    return content.substring(0, 200) + '...';
  }

  async translateText(text) {
    if (!text) return '';
    
    try {
      const { text: translatedText } = await translate(text, { to: 'zh-CN' });
      return translatedText;
    } catch (error) {
      console.error('翻译失败');
      throw error;
    }
  }
}

module.exports = CrawlerService;