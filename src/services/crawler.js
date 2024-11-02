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
      console.log('\n============= 开始抓取文章 =============');
      console.log('RSS源:', this.rssSources.map(s => s.name).join(', '));
      
      let allArticles = [];
      
      for (const source of this.rssSources) {
        try {
          console.log(`\n正在从 ${source.name} 抓取...`);
          const feed = await this.parser.parseURL(source.url);
          console.log(`获取到 ${feed.items.length} 篇文章`);
          
          for (const item of feed.items) {
            try {
              console.log('\n处理文章:', item.title);
              const processedArticle = await this.processRssItem(item, source);
              if (processedArticle && processedArticle.content) {
                const scoreResult = this.calculateArticleScore(processedArticle.title);
                console.log('文章评分:', {
                  score: scoreResult.score,
                  category: scoreResult.category
                });
                
                allArticles.push({
                  ...processedArticle,
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

      console.log(`\n候选文章数量: ${allArticles.length}`);

      if (allArticles.length > 0) {
        const selectedArticle = allArticles.sort((a, b) => b.score - a.score)[0];
        console.log('\n选中文章:', {
          title: selectedArticle.title,
          score: selectedArticle.score,
          category: selectedArticle.category
        });

        const existingArticle = await Article.findOne({ url: selectedArticle.link });
        if (!existingArticle) {
          console.log('\n开始翻译...');
          const translatedTitle = await this.translateText(selectedArticle.title);
          const translatedContent = await this.translateText(selectedArticle.content);
          const summary = this.generateSummary(selectedArticle.content);
          const translatedSummary = await this.translateText(summary);

          const savedArticle = await Article.create({
            title: translatedTitle,
            content: translatedContent,
            summary: translatedSummary,
            source: selectedArticle.source,
            url: selectedArticle.link,
            publishDate: new Date(selectedArticle.pubDate),
            category: selectedArticle.category
          });

          console.log(`\n保存成功: ${translatedTitle}`);
          return [savedArticle];
        } else {
          console.log(`\n文章已存在，跳过: ${selectedArticle.title}`);
          return [];
        }
      } else {
        console.log('\n没有找到任何文章');
        return [];
      }
    } catch (error) {
      console.error('抓取文章失败:', error);
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
          console.log('\n========= TechCrunch 文章原文 =========');
          console.log(item.content || item.description);
          console.log('\n========= 处理后的内容 =========');
          console.log(content);
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
      
      // 获取处理后的文本
      let cleanText = $.text();
      
      // 清理多余的空行和空格
      cleanText = cleanText
        .replace(/\n{3,}/g, '\n\n')  // 将多个空行减少为两个
        .replace(/\s+/g, ' ')        // 将多个空格合并为一个
        .trim();
      
      // 按段落重新格式化
      const paragraphs = cleanText.split('\n\n');
      const formattedParagraphs = paragraphs
        .map(p => p.trim())
        .filter(p => p);
      
      return formattedParagraphs.join('\n\n');
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
            content: `你是一个专业的中文翻译专家。请遵循以下规则：
1. 将英文内容完整翻为中文
2. 保持原文的格式和结构
3. 技术术语的处理规则：
   - 首次出现时，保留英文原文并在括号中给出中文翻译
   - 后续出现时直接使用中文翻译
4. 代码块内容保持原样不翻译
5. 链接文本要翻译，但URL保持原样
6. 不要添加任何解释或评论
7. 保持专业性，避免口语化表达`
          },
          {
            role: "user",
            content: `请按照上述规则翻译以下内容：\n\n${text}`
          }
        ],
        temperature: 0.2,  // 降低随机性，使翻译更稳定
        max_tokens: 4000
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('翻译失败:', error);
      
      if (error.message.includes('maximum context length')) {
        console.log('内容太长，尝试分段翻译');
        const segments = this.splitTextIntoSegments(text, 3000);
        const translatedSegments = await Promise.all(
          segments.map(segment => this.translateText(segment))
        );
        return translatedSegments.join('\n\n');
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