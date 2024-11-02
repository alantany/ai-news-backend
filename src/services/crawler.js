const Parser = require('rss-parser');
const { OpenAI } = require('openai');
const Article = require('../models/Article');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

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
      // 使用默认值
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
      console.log('开始抓取文章...');
      
      // 确保分类配置已初始化
      if (!this.articleCategories) {
        this.initializeCategories();
      }
      
      let allArticles = [];
      
      for (const source of this.rssSources) {
        try {
          console.log(`\n正在从 ${source.name} 抓取...`);
          const feed = await this.parser.parseURL(source.url);
          
          for (const item of feed.items) {
            try {
              const processedArticle = await this.processRssItem(item, source);
              if (processedArticle && processedArticle.content) {
                // 确保有内容后再计算分数
                console.log('计算文章分数:', processedArticle.title);
                const scoreResult = this.calculateArticleScore(
                  processedArticle.title,
                  processedArticle.content
                );
                
                allArticles.push({
                  ...processedArticle,
                  score: scoreResult.score,
                  category: scoreResult.category
                });
                
                console.log('文章处理完成:', {
                  title: processedArticle.title,
                  score: scoreResult.score,
                  category: scoreResult.category
                });
              }
            } catch (error) {
              console.error('处理单篇文章失败:', error);
              continue;
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
            console.log('准备翻译文章:', article.title);
            
            const translatedTitle = await this.translateText(article.title);
            const translatedContent = await this.translateText(article.content);
            const summary = this.generateSummary(article.content);
            const translatedSummary = await this.translateText(summary);

            const savedArticle = await Article.create({
              title: translatedTitle,
              content: translatedContent,
              summary: translatedSummary,
              source: article.source,
              url: article.link,
              publishDate: new Date(article.pubDate),
              category: article.category
            });

            console.log(`保存新文章成功: ${translatedTitle} (${article.category})`);
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

  calculateArticleScore(title = '', content = '') {
    try {
      console.log('开始计算文章分数');
      console.log('articleCategories 是否存在:', !!this.articleCategories);
      
      // 确保 articleCategories 已初始化
      if (!this.articleCategories) {
        console.log('articleCategories 未初始化，重新初始化');
        this.initializeCategories();
      }

      let maxScore = 0;
      let category = 'GENERAL_AI';

      const text = `${title} ${content}`.toLowerCase();
      
      Object.entries(this.articleCategories).forEach(([cat, config]) => {
        config.keywords.forEach(keyword => {
          if (text.includes(keyword.toLowerCase())) {
            const score = config.weight;
            if (score > maxScore) {
              maxScore = score;
              category = cat;
            }
          }
        });
      });

      console.log('文章评分结果:', {
        title: title.substring(0, 50) + '...',
        score: maxScore,
        category
      });

      return { score: maxScore, category };
    } catch (error) {
      console.error('计算文章分数失败:', error);
      return { score: 0, category: 'GENERAL_AI' };
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
          break;
          
        case 'Microsoft AI Blog':
          content = await this.processMicrosoftArticle(item);
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

      return {
        title: item.title || '',
        content: content,
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
    console.log('处理 Microsoft 文章');
    try {
      // Microsoft 博客通常在 content 字段包含完整内容
      let content = item.content || '';
      content = this.cleanHtmlContent(content);
      
      if (!content && item.link) {
        content = await this.fetchFullContent(item.link, 'microsoft');
      }
      
      return content;
    } catch (error) {
      console.error('处理 Microsoft 文章失败:', error);
      return null;
    }
  }

  async processTechCrunchArticle(item) {
    console.log('处理 TechCrunch 文章');
    try {
      // TechCrunch 通常需要从原文获取内容
      let content = await this.fetchFullContent(item.link, 'techcrunch');
      if (!content) {
        content = item.content || item.description || '';
      }
      return this.cleanHtmlContent(content);
    } catch (error) {
      console.error('处理 TechCrunch 文章失败:', error);
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

  async fetchFullContent(url, source) {
    try {
      console.log('尝试获取完整文章内容:', url);
      const response = await fetch(url);
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // 根据不同源使用不同的选择器
      switch (source) {
        case 'medium':
          return $('article').text() || $('.story-content').text();
          
        case 'microsoft':
          return $('.article-content').text() || $('main').text();
          
        case 'techcrunch':
          return $('.article-content').text() || $('.article__content').text();
          
        default:
          return $('article').text() || $('main').text();
      }
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