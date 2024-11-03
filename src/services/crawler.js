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
      console.log(`计划抓取数量: ${articlesPerSource}`);
      
      let allArticles = [];
      
      for (const source of this.rssSources) {
        try {
          console.log(`\n抓取源: ${source.name}`);
          const feed = await this.parser.parseURL(source.url);
          
          for (const item of feed.items) {
            const processedArticle = await this.processRssItem(item, source);
            if (processedArticle && processedArticle.content) {
              const scoreResult = this.calculateArticleScore(processedArticle.title, source.name);
              allArticles.push({
                ...processedArticle,
                score: scoreResult.score,
                category: scoreResult.category
              });
            }
          }
        } catch (error) {
          console.error(`抓取失败: ${source.name}`);
          continue;
        }
      }

      // 按分数排序
      allArticles.sort((a, b) => b.score - a.score);
      const selectedArticles = allArticles.slice(0, articlesPerSource);

      // 显示分类统计
      const categories = selectedArticles.reduce((acc, article) => {
        acc[article.category] = (acc[article.category] || 0) + 1;
        return acc;
      }, {});
      console.log('\n文章分类统计:', categories);

      // 保存文章
      const savedArticles = [];
      for (const article of selectedArticles) {
        try {
          const existingArticle = await Article.findOne({ url: article.link });
          if (existingArticle) {
            console.log('已存在，跳过');
            continue;
          }

          console.log('\n翻译处理中...');
          const combinedText = `[TITLE]${article.title}[/TITLE]\n\n${article.content}`;
          const translatedText = await this.translateText(combinedText);
          
          const titleMatch = translatedText.match(/\[TITLE\](.*?)\[\/TITLE\]/);
          const translatedTitle = titleMatch ? titleMatch[1].trim() : article.title;
          const translatedContent = translatedText
            .replace(/\[TITLE\].*?\[\/TITLE\]\s*/, '')
            .trim();
          
          const translatedSummary = this.generateSummary(translatedContent);

          const savedArticle = await Article.create({
            title: translatedTitle,
            content: translatedContent,
            summary: translatedSummary,
            source: article.source,
            url: article.link,
            publishDate: new Date(article.pubDate),
            category: article.category
          });

          console.log('保存成功');
          savedArticles.push(savedArticle);
        } catch (error) {
          console.error('保存失败');
          continue;
        }
      }

      console.log(`\n本次保存: ${savedArticles.length} 篇`);
      return savedArticles;
    } catch (error) {
      console.error('抓取失败:', error.message);
      throw error;
    }
  }

  async processRssItem(item, source) {
    try {
      console.log(`\n处理来自 ${source.name} 的文章:`, item.title);
      
      let content = '';
      
      // 根据不同的源使用不同的处理逻辑
      switch (source.name) {
        case 'Towards Data Science':
          content = await this.processMediumArticle(item);
          console.log('\n========= Medium 文章原文 =========');
          console.log(item.content || item.contentSnippet || item.description || '');
          console.log('\n========= 处理后的内容 =========');
          console.log(content);
          break;
          
        case 'Microsoft AI Blog':
          content = await this.processMicrosoftArticle(item);
          console.log('\n========= Microsoft 文章原文 =========');
          console.log(item.content);
          console.log('\n========= 处理后的内容 =========');
          console.log(content);
          break;
          
        case 'TechCrunch AI':
          content = await this.processTechCrunchArticle(item);
          break;
          
        default:
          content = await this.processDefaultArticle(item);
      }

      if (!content) {
        console.log('无法获取有效内容，跳过此文章');
        return null;
      }

      // 在翻译前后也添加日志
      console.log('\n========= 翻译前的内容 =========');
      console.log(content);
      
      const translatedTitle = await this.translateText(item.title);
      const translatedContent = await this.translateText(content);
      
      console.log('\n========= 翻译后的内容 =========');
      console.log(translatedContent);

      return {
        title: translatedTitle,
        content: translatedContent,
        link: item.link,
        pubDate: item.pubDate || item.isoDate,
        source: source.name
      };
    } catch (error) {
      console.error('处理文章失败:', error);
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
      
      // 处理代码块
      $('pre, code').each((i, elem) => {
        const code = $(elem).text().trim();
        $(elem).replaceWith(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
      });
      
      // 处理标题
      $('h1, h2, h3, h4, h5, h6').each((i, elem) => {
        const level = elem.name[1]; // 获取标题级别
        const text = $(elem).text().trim();
        const prefix = '#'.repeat(level);
        $(elem).replaceWith(`\n\n${prefix} ${text}\n\n`);
      });
      
      // 处理段落
      $('p').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) {
          $(elem).replaceWith(`\n\n${text}\n\n`);
        }
      });
      
      // 处理列表
      $('ul, ol').each((i, elem) => {
        const items = [];
        $(elem).find('li').each((j, li) => {
          const text = $(li).text().trim();
          items.push(`• ${text}`);
        });
        $(elem).replaceWith(`\n\n${items.join('\n')}\n\n`);
      });
      
      // 处理引用
      $('blockquote').each((i, elem) => {
        const text = $(elem).text().trim();
        $(elem).replaceWith(`\n\n> ${text}\n\n`);
      });
      
      // 处理链接
      $('a').each((i, elem) => {
        const text = $(elem).text().trim();
        const href = $(elem).attr('href');
        if (text && href) {
          $(elem).replaceWith(`[${text}](${href})`);
        }
      });
      
      return this.formatContent($);
    } catch (error) {
      console.error('清理 HTML 内容失败');
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

  async baiduTranslate(text, retries = 3) {
    if (retries <= 0) {
      console.log('百度翻译重试次数用完');
      return null;
    }

    try {
      // 检查文本长度限制
      const maxLength = 6000;
      if (text.length > maxLength) {
        console.log('文本超长，进行分段翻译');
        const parts = [];
        for (let i = 0; i < text.length; i += maxLength) {
          const part = text.slice(i, i + maxLength);
          const translatedPart = await this.baiduTranslate(part, retries);
          if (translatedPart) {
            parts.push(translatedPart);
          } else {
            throw new Error('分段翻译失败');
          }
          // 每段翻译后等待一秒
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return parts.join('\n');
      }

      // 生成签名
      const salt = Date.now().toString();
      const str = this.BAIDU_APP_ID + text + salt + this.BAIDU_SECRET;
      const sign = md5(str);

      // 准备请求参数
      const params = {
        q: text,
        from: 'en',
        to: 'zh',
        appid: this.BAIDU_APP_ID,
        salt: salt,
        sign: sign
      };

      // 发送请求
      const response = await fetch('https://fanyi-api.baidu.com/api/trans/vip/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(params).toString()
      });

      const result = await response.json();

      // 处理错误码
      if (result.error_code) {
        console.log('百度翻译返回错误:', result.error_code, result.error_msg);
        
        // 根据错误码处理
        switch (result.error_code) {
          case '54003': // 访问频率受限
            await new Promise(resolve => setTimeout(resolve, 2000));
            return this.baiduTranslate(text, retries - 1);
          case '52001': // 请求超时
          case '52002': // 系统错误
            await new Promise(resolve => setTimeout(resolve, 1000));
            return this.baiduTranslate(text, retries - 1);
          case '54001': // 签名错误
            console.error('签名错误，请检查 APP ID 和密钥');
            return null;
          default:
            throw new Error(`百度翻译错误: ${result.error_msg}`);
        }
      }

      // 处理翻译结果
      if (result.trans_result && result.trans_result.length > 0) {
        return result.trans_result.map(item => item.dst).join('\n');
      }

      throw new Error('翻译结果为空');
    } catch (error) {
      console.error('百度翻译失败:', error.message);
      if (retries > 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.baiduTranslate(text, retries - 1);
      }
      return null;
    }
  }

  async translateText(text) {
    if (!text) return '';
    
    try {
      // 首先尝试使用百度翻译
      const baiduResult = await this.baiduTranslate(text);
      if (baiduResult) {
        return baiduResult;
      }

      // 如果百度翻译失败，使用 Google 翻译作为备选
      console.log('切换到 Google 翻译');
      const { text: googleResult } = await translate(text, { to: 'zh-CN' });
      return googleResult;
    } catch (error) {
      console.error('翻译失败:', error.message);
      throw error;
    }
  }
}

module.exports = CrawlerService;