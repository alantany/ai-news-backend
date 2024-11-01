const Parser = require('rss-parser');
const Article = require('../models/Article');

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
        name: 'Reddit r/artificial',
        url: 'https://www.reddit.com/r/artificial/.rss'
      },
      {
        name: 'OpenAI Blog',
        url: 'https://openai.com/blog/rss.xml'
      }
    ];
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
          
          const articles = feed.items.map(item => ({
            title: item.title,
            content: item.content || item.description || '',
            summary: this.generateSummary(item.content || item.description || ''),
            source: source.name,
            url: item.link || item.guid,
            publishDate: new Date(item.pubDate || item.isoDate),
            category: 'AI',
            likes: 0,
            views: 0
          }));

          allArticles = [...allArticles, ...articles];
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