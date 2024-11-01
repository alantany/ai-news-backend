const Parser = require('rss-parser');
const Article = require('../models/Article');

class CrawlerService {
  constructor() {
    this.parser = new Parser();
    this.rssSources = [
      {
        name: 'OpenAI Blog',
        url: 'https://openai.com/blog/rss.xml'
      },
      {
        name: 'Google AI Blog',
        url: 'http://ai.googleblog.com/feeds/posts/default'
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
          
          const articles = feed.items.map(item => ({
            title: item.title,
            content: item.content || item.description,
            source: source.name,
            url: item.link,
            publishDate: new Date(item.pubDate),
            category: 'AI'
          }));

          allArticles = [...allArticles, ...articles];
        } catch (error) {
          console.error(`从 ${source.name} 抓取失败:`, error);
          continue;
        }
      }

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
}

module.exports = new CrawlerService(); 