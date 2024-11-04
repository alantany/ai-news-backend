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
        .filter(line => line && !line.startsWith('#'));

      this.rssSources = urls.map(url => ({
        name: this.getRssSourceName(url),
        url: url
      }));

      // 如果配置了 arXiv，添加 RAG 论文源
      if (this.rssSources.some(s => s.name === 'arXiv RAG Papers')) {
        await this.loadArxivPapers();
      }
    } catch (error) {
      console.error('加载 RSS 源失败:', error);
      this.rssSources = [];
    }
  }

  async loadArxivPapers() {
    try {
      console.log('获取 arXiv RAG 论文...');
      const query = encodeURIComponent('all:"Retrieval Augmented Generation" OR all:RAG');
      const url = `http://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=5`;
      
      const response = await fetch(url);
      const xml = await response.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      
      // 解析每篇论文
      const papers = [];
      $('entry').each((i, entry) => {
        const $entry = $(entry);
        papers.push({
          title: $entry.find('title').text(),
          link: $entry.find('id').text(),
          description: $entry.find('summary').text(),
          pubDate: new Date($entry.find('published').text()),
          source: 'arXiv RAG Papers'
        });
      });

      // 将论文添加到 RSS items
      if (papers.length > 0) {
        this.arxivPapers = papers;
        console.log(`找到 ${papers.length} 篇 RAG 相关论文`);
      }
    } catch (error) {
      console.error('获取 arXiv 论文失败:', error);
    }
  }

  getRssSourceName(url) {
    if (url.includes('towardsdatascience.com')) return 'Towards Data Science';
    if (url.includes('blogs.microsoft.com')) return 'Microsoft AI Blog';
    if (url.includes('blog.research.google')) return 'Google AI Blog';
    if (url.includes('arxiv.org')) return 'arXiv RAG Papers';
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
      
      let allArticles = [];
      
      // 遍历所有 RSS 源
      for (const source of this.rssSources) {
        try {
          console.log(`\n抓取源: ${source.name}`);
          const feed = await this.parser.parseURL(source.url);
          
          // 处理每篇文章
          for (const item of feed.items) {
            const processedArticle = await this.processRssItem(item, source);
            if (processedArticle) {
              allArticles.push(processedArticle);
            }
          }
        } catch (error) {
          console.error(`抓取失败: ${source.name}`, error);
          continue;
        }
      }

      console.log(`\n总共处理 ${allArticles.length} 篇文章`);

      // 保存文章
      const savedArticles = [];
      for (const article of allArticles) {
        try {
          // 先检查文章是否已存在
          const existingArticle = await Article.findOne({ url: article.url });
          if (existingArticle) {
            console.log('文章已存在，跳过:', article.title);
            continue;
          }

          // 保存新文章
          const savedArticle = await Article.create(article);
          console.log('保存成功:', savedArticle.title);
          savedArticles.push(savedArticle);
        } catch (error) {
          if (error.code === 11000) {  // 重复键错误
            console.log('文章已存在（并发检查）:', article.title);
          } else {
            console.error('保存失败:', {
              title: article.title,
              error: error.message
            });
          }
        }
      }

      console.log(`\n本次保存: ${savedArticles.length} 篇`);
      return savedArticles;
    } catch (error) {
      console.error('抓取过程失败:', error);
      throw error;
    }
  }

  async processRssItem(item, source) {
    try {
      console.log('处理文章:', item.title);

      if (!item.title) {
        console.log('文章缺少标题，跳过');
        return null;
      }

      // 获取 arXiv ID
      const arxivId = item.link.match(/\d{4}\.\d{5}/)?.[0];
      if (!arxivId) {
        console.log('无法获取 arXiv ID');
        return null;
      }

      // 获取 HTML 内容
      const htmlUrl = `https://arxiv.org/html/${arxivId}`;
      const response = await fetch(htmlUrl);
      const html = await response.text();
      const $ = cheerio.load(html);

      // 提取内容并强制分段
      let contentParts = [];

      // 先获取摘要
      const abstract = $('.abstract').text().trim();
      if (abstract) {
        contentParts.push('摘要：\n' + abstract.replace('Abstract:', '').trim() + '\n\n');
      }

      // 获取正文各个部分
      $('.ltx_section').each((i, section) => {
        const $section = $(section);
        
        // 获取标题
        const title = $section.find('.ltx_title').first().text().trim();
        if (title) {
          contentParts.push(`\n### ${title}\n\n`);
        }

        // 获取段落
        $section.find('p').each((j, p) => {
          const text = $(p).text().trim();
          if (text) {
            contentParts.push(text + '\n\n');
          }
        });
      });

      // 合并内容，确保分段
      const content = contentParts.join('');

      // 打印分段信息
      console.log('内容分段情况:', {
        partsCount: contentParts.length,
        hasNewlines: content.includes('\n\n'),
        firstPart: contentParts[0]?.substring(0, 100),
        newlineCount: (content.match(/\n/g) || []).length
      });

      // 处理数学公式和引用
      $('.ltx_equation, .ltx_cite').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) {
          content = content.replace(text, `**${text}**`);  // 加粗处理
        }
      });

      // 处理重要术语
      $('.ltx_theorem, .ltx_definition').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) {
          content = content.replace(text, `**${text}**`);
        }
      });

      // 清理和格式化内容
      content = content
        .replace(/\n{3,}/g, '\n\n')  // 多个换行替换为两个
        .replace(/\s+/g, ' ')        // 合并多个空格
        .trim();

      // 生成摘要
      const summary = content.substring(0, 200) + '...';

      // 处理发布日期
      let publishDate = new Date(item.pubDate || item.isoDate);
      if (!publishDate || isNaN(publishDate)) {
        const year = '20' + arxivId.substring(0, 2);
        const month = arxivId.substring(2, 4);
        publishDate = new Date(year, month - 1);
      }

      // 打印调试信息
      console.log('处理结果:', {
        hasTitle: !!item.title,
        hasUrl: !!item.link,
        hasContent: !!content,
        contentLength: content.length,
        hasSummary: !!summary,
        publishDate: publishDate
      });

      return {
        title: item.title.trim(),
        content: content,
        summary: summary,
        url: item.link,
        publishDate: publishDate,
        source: source.name
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

  cleanHtmlContent(content) {
    if (!content) return '';
    
    try {
      // 先移除所有作者和摘要相关的内容
      let cleanedContent = content
        // 移除XML样式标签
        .replace(/<作者>[\s\S]*?<\/作者>/g, '')
        .replace(/<摘要>[\s\S]*?<\/摘要>/g, '')
        // 移除普通文本格式
        .replace(/作者[\s\S]*?\n/g, '')
        .replace(/摘要[\s\S]*?\n/g, '')
        // 移除其他可能的格式
        .replace(/Authors?:[\s\S]*?\n/g, '')
        .replace(/Abstract:[\s\S]*?\n/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // 如果内容以换行开始，移除开头的换行
      while (cleanedContent.startsWith('\n')) {
        cleanedContent = cleanedContent.substring(1);
      }

      const $ = cheerio.load(cleanedContent);
      
      // 移除不需要的元素
      $('script, style, iframe, nav, header, footer').remove();
      
      // 只保留正文段落
      let paragraphs = [];
      $('p').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) {
          paragraphs.push(text);
        }
      });

      // 如果没有找到段落标签，按换行符分割
      if (paragraphs.length === 0) {
        paragraphs = cleanedContent
          .split(/\n+/)
          .map(p => p.trim())
          .filter(p => p.length > 0)
          .filter(p => !p.includes('作者') && !p.includes('摘要')); // 额外过滤
      }

      console.log('清理后的段落数:', paragraphs.length);
      return paragraphs.join('\n\n');
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
    // 确保移除所有标签和作者信息
    const cleanContent = content
      .replace(/<[^>]+>/g, '')
      .replace(/作者[\s\S]*?\n/g, '')
      .replace(/Authors?:[\s\S]*?\n/g, '')
      .trim();

    // 取前200个字符
    return cleanContent.substring(0, 200) + '...';
  }

  // 翻译时保持格式
  async translateText(text) {
    if (!text) return '';
    
    try {
      // 保存格式标记
      const markers = [];
      let markedText = text;
      
      // 保护标题标记
      markedText = markedText.replace(/\n#\s+(.*?)\n/g, (match, title) => {
        markers.push({ type: 'title', content: title });
        return `\n[TITLE${markers.length - 1}]\n`;
      });

      // 保护加粗文本
      markedText = markedText.replace(/\*\*(.*?)\*\*/g, (match, bold) => {
        markers.push({ type: 'bold', content: bold });
        return `[BOLD${markers.length - 1}]`;
      });

      // 翻译处理后的文本
      const { text: translatedText } = await translate(markedText, { to: 'zh-CN' });

      // 还原格式标记
      let finalText = translatedText;
      markers.forEach((marker, index) => {
        if (marker.type === 'title') {
          finalText = finalText.replace(
            `[TITLE${index}]`,
            `\n# ${marker.content}\n`
          );
        } else if (marker.type === 'bold') {
          finalText = finalText.replace(
            `[BOLD${index}]`,
            `**${marker.content}**`
          );
        }
      });

      return finalText;
    } catch (error) {
      console.error('翻译失败:', error);
      throw error;
    }
  }

  async fetchArxivContent(arxivId) {
    try {
      // 使用 arXiv API 获取论文信息
      const response = await fetch(`http://export.arxiv.org/api/query?id_list=${arxivId}`);
      const xml = await response.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      
      const title = $('entry > title').text();
      const abstract = $('entry > summary').text();
      const authors = $('entry > author > name').map((i, el) => $(el).text()).get().join(', ');
      
      return {
        title,
        content: `Authors: ${authors}\n\n${abstract}`,
        link: `https://arxiv.org/abs/${arxivId}`
      };
    } catch (error) {
      console.error('获取 arXiv 内容失败:', error);
      return null;
    }
  }

  async processArxivArticle(item) {
    try {
      console.log('arXiv 原始数据:', {
        title: item.title,
        link: item.link,
        id: item.id
      });

      // 从 link 中提取 arXiv ID，支持多种格式
      let arxivId;
      const patterns = [
        /arxiv\.org\/abs\/([\d.]+)/,    // 标准格式
        /arxiv\.org\/pdf\/([\d.]+)/,     // PDF 链接
        /\/(\d{4}\.\d{5})(?:v\d+)?$/,    // 纯数字格式
        /(\d{4}\.\d{5})(?:v\d+)?/        // 任何位置的 arXiv ID
      ];

      for (const pattern of patterns) {
        const match = (item.link || '').match(pattern);
        if (match) {
          arxivId = match[1];
          break;
        }
      }

      if (!arxivId) {
        console.error('无法获取 arXiv ID，原始链接:', item.link);
        return null;
      }

      console.log('获取到 arXiv ID:', arxivId);
      const htmlUrl = `https://arxiv.org/html/${arxivId}`;
      console.log('获取 HTML 版本:', htmlUrl);

      const response = await fetch(htmlUrl);
      if (!response.ok) {
        console.error('获取 HTML 失败:', response.status);
        return null;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // 更新作者提取逻辑
      let authors = '';
      $('.ltx_authors .ltx_personname').each((i, el) => {
        authors += (i > 0 ? ', ' : '') + $(el).text().trim();
      });
      console.log('作者:', authors);
      
      // 更新摘要提取逻辑
      let abstract = '';
      $('.ltx_abstract').each((i, el) => {
        const text = $(el).text().trim();
        if (text && !abstract) {  // 只取第一个摘要
          abstract = text.replace(/^Abstract[.: ]*/, '').trim();
        }
      });
      console.log('摘要长度:', abstract.length);
      
      // 更新正文提取逻辑
      const sections = [];
      $('.ltx_section').each((i, section) => {
        const $section = $(section);
        const title = $section.find('.ltx_title').first().text().trim();
        
        // 收集段落
        const paragraphs = [];
        $section.find('p, .ltx_para').each((j, p) => {
          const text = $(p).text().trim();
          if (text) {
            paragraphs.push(text);
          }
        });
        
        if (title && paragraphs.length > 0) {
          sections.push(`<title>${title}</title>\n\n${paragraphs.join('\n\n')}`);
        }
      });
      console.log('提取到的章节数:', sections.length);

      // 检查是否成功提取了内容
      if (!authors || !abstract || sections.length === 0) {
        console.log('尝试备用选择器');
        // 备用作者选择器
        if (!authors) {
          authors = $('.ltx_author_notes').text().trim() || 
                   $('[class*="author"]').text().trim();
        }
        // 备用摘要选择器
        if (!abstract) {
          abstract = $('[class*="abstract"]').text().trim() ||
                    $('.abstract-full').text().trim();
        }
      }

      // 组合所有内容
      const fullContent = [
        `<authors>${authors || '作者信息未找到'}</authors>`,
        `\n<abstract>摘要：\n${abstract || '摘要未找到'}</abstract>`,
        ...sections
      ].join('\n\n');

      console.log('处理完成，内容统计:', {
        hasAuthors: !!authors,
        hasAbstract: !!abstract,
        sectionsCount: sections.length,
        totalLength: fullContent.length
      });
      
      return fullContent;
    } catch (error) {
      console.error('处理 arXiv 文章失败:', error.message);
      return null;
    }
  }
}

module.exports = CrawlerService;