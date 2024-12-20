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
      
      // 过滤注释和空行，只保留有效的 URL
      const urls = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      this.rssSources = urls.map(url => ({
        name: this.getRssSourceName(url),
        url: url
      }));

      console.log('\n加载的 RSS 源:');
      this.rssSources.forEach(source => {
        console.log(`- ${source.name}: ${source.url}`);
      });
    } catch (error) {
      console.error('加载 RSS 源失败:', error);
      this.rssSources = [];
    }
  }

  getRssSourceName(url) {
    if (url.includes('microsoft.com')) return 'Microsoft AI Blog';
    if (url.includes('research.google')) return 'Google AI Blog';
    if (url.includes('arxiv.org')) return 'arXiv RAG Papers';
    return new URL(url).hostname;
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
      const articlesPerSource = settings.preArticlesPerSource;
      console.log(`每个源抓取数量: ${articlesPerSource}`);
      
      let allArticles = [];
      
      // 分别处理每个源
      for (const source of this.rssSources) {
        try {
          console.log(`\n开始处理源: ${source.name}`);
          console.log(`URL: ${source.url}`);
          
          const feed = await this.parser.parseURL(source.url);
          console.log(`源返回文章数: ${feed.items?.length || 0}`);
          
          if (!feed.items || feed.items.length === 0) {
            console.log(`警告: ${source.name} 没有返回任何文章`);
            continue;
          }
          
          // 处理当前源的文章，限制每个源的数量
          const sourceArticles = [];
          const itemsToProcess = feed.items.slice(0, articlesPerSource);
          
          console.log(`准备处理 ${itemsToProcess.length} 篇文章，来自 ${source.name}`);
          
          for (const item of itemsToProcess) {
            try {
              const processedArticle = await this.processRssItem(item, source);
              if (processedArticle) {
                sourceArticles.push(processedArticle);
              }
            } catch (error) {
              console.error(`处理文章失败: ${item.title}`, error);
            }
          }

          allArticles.push(...sourceArticles);
          console.log(`从 ${source.name} 获取到 ${sourceArticles.length} 篇文章`);
        } catch (error) {
          console.error(`抓取源失败: ${source.name}`, error);
          continue;
        }
      }

      console.log('\n抓取统计:');
      console.log(`总源数: ${this.rssSources.length}`);
      console.log(`每源限制: ${articlesPerSource}`);
      console.log(`总处理文章数: ${allArticles.length}`);

      // 保存文章
      const savedArticles = [];
      for (const article of allArticles) {
        try {
          const existingArticle = await Article.findOne({
            $or: [
              { title: article.title },
              { url: article.url }
            ]
          });

          if (existingArticle) {
            console.log('文章已存在，跳过:', article.title);
            continue;
          }

          const savedArticle = await Article.create(article);
          console.log('保存成功:', savedArticle.title);
          savedArticles.push(savedArticle);
        } catch (error) {
          console.error('保存失败:', {
            title: article.title,
            error: error.message
          });
        }
      }

      console.log('\n保存统计:');
      console.log(`总处理文章数: ${allArticles.length}`);
      console.log(`成功保存文章数: ${savedArticles.length}`);

      // 更新最后抓取时间
      await Setting.findOneAndUpdate(
        {},
        { 
          $set: { 
            lastCrawlTime: new Date(),
            nextCrawlTime: new Date(Date.now() + (settings.crawlInterval || 60) * 60000)
          } 
        },
        { upsert: true }
      );

      return savedArticles;
    } catch (error) {
      console.error('抓取过程失败:', error);
      throw error;
    }
  }

  async processRssItem(item, source) {
    try {
      console.log('处理文章:', item.title);

      if (!item.title || !item.link) {
        console.log('文章缺少标题或链接，跳过');
        return null;
      }

      // 根据不同源使用不同的处理逻辑
      let content = '';
      let pubDate = null;

      switch (source.name) {
        case 'arXiv RAG Papers':
          return await this.processArxivArticle(item, source);
        
        case 'Microsoft AI Blog':
          return await this.processMicrosoftArticle(item, source);
        
        case 'Google AI Blog':
          return await this.processGoogleArticle(item, source);
        
        default:
          console.log('未知的源类型:', source.name);
          return null;
      }
    } catch (error) {
      console.error('处理文章失败:', error);
      return null;
    }
  }

  // arXiv 文章处理
  async processArxivArticle(item, source) {
    try {
      const arxivId = item.link.match(/\d{4}\.\d{5}/)?.[0];
      if (!arxivId) {
        console.log('无法获取 arXiv ID');
        return null;
      }

      console.log('获取 arXiv 文章:', arxivId);
      const htmlUrl = `https://arxiv.org/html/${arxivId}`;
      const response = await fetch(htmlUrl);
      const html = await response.text();
      const $ = cheerio.load(html);

      // 尝试多个可能的摘要选择器
      let abstract = '';
      const abstractSelectors = [
        '.abstract',
        '.ltx_abstract',
        '#abstract',
        'div[class*="abstract"]',
        'div[id*="abstract"]'
      ];

      for (const selector of abstractSelectors) {
        const $abstract = $(selector);
        if ($abstract.length) {
          abstract = $abstract.text()
            .replace(/^Abstract[.: ]*/, '')  // 移除 "Abstract:" 前缀
            .trim();
          if (abstract) break;
        }
      }

      // 如果还是找不到摘要，尝试从第一段获取
      if (!abstract) {
        abstract = $('p').first().text().trim();
      }

      console.log('摘要提取结果:', {
        found: !!abstract,
        length: abstract.length,
        preview: abstract.substring(0, 100) + '...'
      });

      // 提取正文（跳过作者和摘要部分）
      let contentParts = [];
      $('.ltx_section').each((i, section) => {
        const $section = $(section);
        const title = $section.find('.ltx_title').first().text().trim();
        
        if (title) {
          contentParts.push(`### ${title}\n\n`);  // 使用 ### 标记标题
        }

        // 提取段落
        $section.find('p').each((j, p) => {
          const text = $(p).text().trim();
          if (text) {
            contentParts.push(`${text}\n\n`);
          }
        });
      });

      // 组合内容
      const content = contentParts.join('');

      console.log('内容处理结果:', {
        hasAbstract: !!abstract,
        abstractLength: abstract.length,
        contentParts: contentParts.length,
        contentLength: content.length
      });

      return {
        title: item.title.trim(),
        content: content,           // 只包含正文，不包含作者和摘要
        summary: abstract,          // 使用摘要作为概要
        url: item.link,
        publishDate: new Date(item.pubDate || item.isoDate),
        source: source.name
      };
    } catch (error) {
      console.error('处理 arXiv 文章失败:', error);
      return null;
    }
  }

  // Microsoft 文章处理
  async processMicrosoftArticle(item, source) {
    try {
      console.log('处理 Microsoft 文章:', item.title);
      const response = await fetch(item.link);
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // 提取容，尝试多个可能的选择器
      let contentParts = [];
      
      // 尝试不同的内容选择器
      $('.article-content, .entry-content, .post-content, main article').find('p, h2, h3').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) {
          if (elem.tagName === 'h2' || elem.tagName === 'h3') {
            contentParts.push(`### ${text}\n\n`);  // 添加标题标记
          } else {
            contentParts.push(`${text}\n\n`);
          }
        }
      });

      const content = contentParts.join('');
      console.log('Microsoft 文章内容长度:', content.length);

      // 生成摘要
      const summary = contentParts.find(p => p.length > 50)?.substring(0, 200) || '';

      return {
        title: item.title.trim(),
        content: this.cleanContent(content),
        summary: summary,
        url: item.link,
        publishDate: new Date(item.pubDate || item.isoDate),
        source: source.name
      };
    } catch (error) {
      console.error('处理 Microsoft 文章失败:', error);
      return null;
    }
  }

  // Google 文章处理
  async processGoogleArticle(item, source) {
    try {
      console.log('处理 Google 文章:', item.title);
      console.log('原始内容预览:', item.content?.substring(0, 200));
      
      // Google AI Blog 的内容直接在 RSS feed 中
      const $ = cheerio.load(item.content || item.description || '');
      
      let contentParts = [];
      
      // 处理所有段落和标题
      $('*').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text) {
          // 检查是否是标题样式
          const fontSize = $(elem).css('font-size');
          const isBold = $(elem).css('font-weight') === 'bold';
          
          if (fontSize?.includes('px') && parseInt(fontSize) > 14 || isBold) {
            contentParts.push(`### ${text}\n\n`);
          } else {
            contentParts.push(`${text}\n\n`);
          }
        }
      });

      // 移除重复内容
      const content = this.cleanContent(contentParts.join(''));
      console.log('Google 文章处理结果:', {
        title: item.title,
        contentLength: content.length,
        hasContent: content.length > 0
      });

      // 生成摘要：使用第一段非空内容
      const summary = contentParts
        .find(p => p.length > 50 && !p.startsWith('###'))
        ?.substring(0, 200) || '';

      return {
        title: item.title.trim(),
        content: content,
        summary: summary,
        url: item.link,
        publishDate: new Date(item.pubDate || item.isoDate),
        source: source.name
      };
    } catch (error) {
      console.error('处理 Google 文章失败:', error);
      console.error('错误详情:', error.message);
      console.error('文章信息:', {
        title: item.title,
        hasContent: !!item.content,
        hasDescription: !!item.description
      });
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

      // 翻译处理的文本
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

  cleanContent(content) {
    if (!content) return '';

    try {
      // 将内容按段落分割
      const paragraphs = content
        .split('\n\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);

      // 去除重复段落
      const uniqueParagraphs = [...new Set(paragraphs)];

      // 检查重复情况
      console.log('内容清理:', {
        originalParagraphs: paragraphs.length,
        uniqueParagraphs: uniqueParagraphs.length,
        duplicatesRemoved: paragraphs.length - uniqueParagraphs.length
      });

      // 重新组合内容
      return uniqueParagraphs.join('\n\n');
    } catch (error) {
      console.error('清理内容失败:', error);
      return content;
    }
  }
}

module.exports = CrawlerService;