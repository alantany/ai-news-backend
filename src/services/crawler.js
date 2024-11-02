const Parser = require('rss-parser');
const { OpenAI } = require('openai');
const Article = require('../models/Article');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const Setting = require('../models/Setting');
const { translate } = require('@vitalets/google-translate-api');

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

  async crawl() {
    try {
      await this.loadRssSources();
      console.log('\n============= 开始抓取文章 =============');
      
      // 获取设置
      const settings = await Setting.findOne() || { preArticlesPerSource: 5 };
      const articlesPerSource = settings.preArticlesPerSource || 5;
      console.log(`每个源抓取数量: ${articlesPerSource}`);
      
      if (!this.rssSources || this.rssSources.length === 0) {
        console.error('没有找到可用的 RSS 源');
        return [];
      }
      console.log('RSS源:', this.rssSources.map(s => s.name).join(', '));
      
      // 只获取第一个源的文章
      const source = this.rssSources[0];
      console.log(`\n从 ${source.name} 抓取文章`);
      
      try {
        const feed = await this.parser.parseURL(source.url);
        console.log(`获取到 ${feed.items.length} 篇文章`);
        
        if (!feed.items || feed.items.length === 0) {
          console.log('没有找到文章');
          return [];
        }

        // 处理文章
        const savedArticles = [];
        for (let i = 0; i < Math.min(articlesPerSource, feed.items.length); i++) {
          const item = feed.items[i];
          console.log(`\n[${i + 1}/${articlesPerSource}] 处理文章: ${item.title}`);
          
          const processedArticle = await this.processRssItem(item, source);
          if (!processedArticle || !processedArticle.content) {
            console.log('处理失败，跳过');
            continue;
          }

          const scoreResult = this.calculateArticleScore(processedArticle.title);
          console.log('评分:', scoreResult.score);

          const existingArticle = await Article.findOne({ url: processedArticle.link });
          if (existingArticle) {
            console.log('已存在，跳过');
            continue;
          }

          console.log('开始翻译...');
          const translatedTitle = await this.translateText(processedArticle.title);
          const translatedContent = await this.translateText(processedArticle.content);
          const translatedSummary = this.generateSummary(translatedContent);

          const savedArticle = await Article.create({
            title: translatedTitle,
            content: translatedContent,
            summary: translatedSummary,
            source: processedArticle.source,
            url: processedArticle.link,
            publishDate: new Date(processedArticle.pubDate),
            category: scoreResult.category
          });

          console.log('保存成功');
          savedArticles.push(savedArticle);
        }

        console.log(`\n本次共保存 ${savedArticles.length} 篇文章`);
        return savedArticles;
      } catch (error) {
        console.error(`抓取失败:`, error);
        return [];
      }
    } catch (error) {
      console.error('抓取过程发生错误:', error);
      throw error;
    }
  }

  calculateArticleScore(title = '') {
    try {
      // 只对标题进行简单的关键词匹配
      const titleLower = title.toLowerCase();
      
      // 简单的优先级匹配
      if (titleLower.includes('rag') || titleLower.includes('retrieval')) {
        return { score: 100, category: 'RAG' };
      }
      
      if (titleLower.includes('llm') || titleLower.includes('gpt') || 
          titleLower.includes('language model') || titleLower.includes('fine-tun')) {
        return { score: 80, category: 'LLM_DEV' };
      }
      
      if (titleLower.includes('chatgpt') || titleLower.includes('claude') || 
          titleLower.includes('gemini') || titleLower.includes('llama')) {
        return { score: 60, category: 'LLM_NEWS' };
      }
      
      // 其他包含 AI 相关词的文章
      if (titleLower.includes('ai') || titleLower.includes('artificial intelligence') || 
          titleLower.includes('machine learning')) {
        return { score: 40, category: 'GENERAL_AI' };
      }

      // 默认分数
      return { score: 20, category: 'GENERAL_AI' };
    } catch (error) {
      console.error('计算文章分数失败:', error);
      return { score: 20, category: 'GENERAL_AI' };
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
        // 如果实在获取不到，使用 RSS 中的描述
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
    if (!content) return '';
    // 直接截取前200个字符作为摘要
    const plainText = content.replace(/<[^>]*>/g, '');
    return plainText.substring(0, 200) + '...';
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