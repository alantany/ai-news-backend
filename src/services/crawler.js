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

    // 添加 Kimi API 配置
    this.KIMI_API_KEY = 'sk-A1EGCQmO3fmcZVllvqXnmeUpTQ3WIO9RdXS85rcxgKQm0cRP';
    this.KIMI_API_URL = 'https://api.moonshot.cn/v1/chat/completions';
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
          console.log('RSS 响应:', {
            itemCount: feed.items.length,
            hasItems: !!feed.items,
            source: source.name
          });
          
          // 获取每个源的前 N 篇文章
          const articles = [];
          for (const item of feed.items.slice(0, articlesPerSource)) {
            const processedArticle = await this.processRssItem(item, source);
            if (processedArticle) {
              const scoreResult = this.calculateArticleScore(processedArticle.title, source.name);
              articles.push({
                ...processedArticle,
                score: scoreResult.score,
                category: scoreResult.category
              });
            }
          }

          allArticles.push(...articles);
          console.log(`获取到 ${articles.length} 篇有效文章`);
        } catch (error) {
          console.error(`抓取失败: ${source.name}`, error);
          continue;
        }
      }

      console.log(`\n总共获取到 ${allArticles.length} 篇有效文章`);

      // 保存所有文章
      const savedArticles = [];
      for (const article of allArticles) {
        try {
          const existingArticle = await Article.findOne({ url: article.link });
          if (existingArticle) {
            console.log('已存在，跳过:', article.title);
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
          console.error('保存失败:', {
            error: error.message,
            title: article.title,
            source: article.source
          });
          continue;
        }
      }

      console.log(`\n本次存: ${savedArticles.length} 篇`);
      return savedArticles;
    } catch (error) {
      console.error('抓取失败:', error);
      throw error;
    }
  }

  async processWithKimi(title, content, retries = 3) {
    if (retries <= 0) {
      throw new Error('超过最大重试次数');
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('开始处理文章:', title);
      
      const requestBody = {
        model: "moonshot-v1-8k",
        messages: [
          {
            role: "system",
            content: "你是一个专业的翻译助手，请将英文文章翻译成中文，保持段落格式，并生成摘要。"
          },
          {
            role: "user",
            content: `请翻译以下文章并按格式返回：

原文标题：${title}

原文内容：${content}

请按照以下格式返回结果：
<title>中文标题</title>
<content>中文正文（保持段落格式）</content>
<summary>200字以内的中文摘要</summary>`
          }
        ],
        temperature: 0.1,
        stream: false
      };

      console.log('发送请求:', JSON.stringify(requestBody, null, 2));

      const response = await fetch(this.KIMI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.KIMI_API_KEY}`
        },
        body: JSON.stringify(requestBody)
      });

      const responseText = await response.text();
      console.log('Kimi 响应状态:', response.status);
      console.log('Kimi 响应内容:', responseText);

      if (response.status === 429) {
        console.log('请求过于频繁，等待后重试');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.processWithKimi(title, content, retries - 1);
      }

      if (response.status === 400) {
        console.error('请求格式错误，请求体:', requestBody);
        throw new Error('API 请求格式错误');
      }

      if (!response.ok) {
        throw new Error(`API 请求失败: ${response.status}`);
      }

      const result = JSON.parse(responseText);
      
      if (!result.choices || !result.choices[0]) {
        throw new Error('API 返回格式错误');
      }

      const output = result.choices[0].message.content;
      
      // 使用新的标记格式解析
      const titleMatch = output.match(/<title>([\s\S]*?)<\/title>/);
      const contentMatch = output.match(/<content>([\s\S]*?)<\/content>/);
      const summaryMatch = output.match(/<summary>([\s\S]*?)<\/summary>/);

      if (!titleMatch || !contentMatch || !summaryMatch) {
        console.error('解析失败，原始输出:', output);
        throw new Error('输出格式解析失败');
      }

      return {
        translatedTitle: titleMatch[1].trim(),
        translatedContent: contentMatch[1].trim(),
        translatedSummary: summaryMatch[1].trim()
      };
    } catch (error) {
      console.error('Kimi 处理失败:', error.message);
      
      if (retries > 1) {
        console.log(`等待后重试，剩余次数: ${retries - 1}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.processWithKimi(title, content, retries - 1);
      }
      
      throw error;
    }
  }

  async processRssItem(item, source) {
    try {
      if (!item.title || !item.link) {
        console.log('文章缺少标题或链接，跳过');
        return null;
      }

      // 获取原始内容
      let content = '';
      switch (source.name) {
        case 'Microsoft AI Blog':
          content = await this.fetchMicrosoftContent(item.link);
          break;
        case 'Towards Data Science':
          content = await this.fetchMediumContent(item.link);
          break;
        default:
          content = item.content || item.contentSnippet || item.description || '';
      }

      if (!content) {
        console.log('获取内容失败');
        return null;
      }

      // 使用 Kimi 处理内容
      const processed = await this.processWithKimi(item.title, content);
      
      return {
        title: item.title.trim(),
        content: content,
        translatedTitle: processed.translatedTitle,
        translatedContent: processed.translatedContent,
        translatedSummary: processed.translatedSummary,
        link: item.link,
        pubDate: item.pubDate || item.isoDate || new Date(),
        source: source.name,
        isTranslated: true
      };
    } catch (error) {
      console.error('处理文章失败:', error);
      return null;
    }
  }

  async fetchMicrosoftContent(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Microsoft 博客的主要内容通常在这些选择器中
      return $('.article-content').text() || 
             $('.entry-content').text() || 
             $('main article').text();
    } catch (error) {
      console.error('获取 Microsoft 文章内容失败');
      return '';
    }
  }

  async fetchMediumContent(url) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Medium 文章的主要内容通常在 article 标签中
      return $('article').text() || $('.story-content').text();
    } catch (error) {
      console.error('获取 Medium 文章内容失败');
      return '';
    }
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