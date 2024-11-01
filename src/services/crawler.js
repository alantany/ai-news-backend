const Parser = require('rss-parser');
const Article = require('../models/Article');
const OpenAI = require('openai');

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

    // 固定的 RSS 源列表
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
        name: 'AI News',
        url: 'https://aibusiness.com/feed'
      }
    ];
  }

  async translateText(text) {
    try {
      console.log('开始翻译文本');
      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "你是一个专业的翻译，需要将英文AI新闻翻译成中文，保持专业性和可读性。"
          },
          {
            role: "user",
            content: `请将以下文本翻译成中文：\n${text}`
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      console.log('翻译成功');
      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('翻译失败:', error);
      console.error('API Key:', process.env.OPENAI_API_KEY ? '已设置' : '未设置');
      console.error('Base URL:', process.env.BASE_URL ? '已设置' : '未设置');
      return text; // 如果翻译失败，返回原文
    }
  }

  async crawl() {
    try {
      console.log('开始抓取文章...');
      let allArticles = [];

      for (const source of this.rssSources) {
        try {
          console.log(`正在从 ${source.name} 抓取...`);
          const feed = await this.parser.parseURL(source.url);
          console.log(`从 ${source.name} 获取到 ${feed.items.length} 篇文章`);
          
          for (const item of feed.items) {
            const title = await this.translateText(item.title);
            const content = item.content || item.description || '';
            const summary = await this.translateText(this.generateSummary(content));

            const article = {
              title,
              content,
              summary,
              source: source.name,
              url: item.link || item.guid,
              publishDate: new Date(item.pubDate || item.isoDate),
              category: 'AI',
              likes: 0,
              views: 0
            };

            allArticles.push(article);
          }
        } catch (error) {
          console.error(`从 ${source.name} 抓取失败:`, error);
          continue;
        }
      }

      // 按发布日期排序
      allArticles.sort((a, b) => b.publishDate - a.publishDate);

      // 保存到数据库
      for (const article of allArticles) {
        await Article.findOneAndUpdate(
          { url: article.url },
          article,
          { upsert: true, new: true }
        );
      }

      console.log(`抓取完成，共获取 ${allArticles.length} 篇文章`);
      return allArticles;
    } catch (error) {
      console.error('抓取文章失败:', error);
      throw error;
    }
  }

  generateSummary(content) {
    if (!content) return '';
    // 移除 HTML 标签
    const text = content.replace(/<[^>]*>/g, '');
    // 取前 200 个字符作为摘要
    return text.slice(0, 200) + '...';
  }
}

module.exports = new CrawlerService(); 