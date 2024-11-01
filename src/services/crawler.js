const Parser = require('rss-parser');
const Article = require('../models/Article');
const fs = require('fs');
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

    // RSS 源映射表
    this.rssMap = {
      'towardsdatascience': 'https://towardsdatascience.com/feed',
      'microsoft': 'https://blogs.microsoft.com/ai/feed/',
      'techcrunch': 'https://techcrunch.com/tag/artificial-intelligence/feed/',
      'AI news': 'https://artificialintelligence-news.com/feed/',
      'openai': 'https://openai.com/blog/rss.xml',
      'reddit': 'https://www.reddit.com/r/artificial/.rss'
    };

    // 从 rss_list.txt 读取源
    try {
      const rssListPath = path.join(__dirname, '../../../rss_list.txt');
      const rssContent = fs.readFileSync(rssListPath, 'utf-8');
      const rssSources = rssContent.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      this.rssSources = rssSources.map(source => {
        // 如果是完整的 URL，直接使用
        if (source.startsWith('http')) {
          return {
            name: new URL(source).hostname,
            url: source
          };
        }
        // 否则从映射表中查找
        return {
          name: source,
          url: this.rssMap[source.toLowerCase()]
        };
      }).filter(source => source.url); // 过滤掉没有 URL 的源

      console.log('已加载 RSS 源:', this.rssSources);
    } catch (error) {
      console.error('读取 RSS 列表失败:', error);
      // 使用默认源
      this.rssSources = [
        {
          name: 'Towards Data Science',
          url: 'https://towardsdatascience.com/feed'
        }
      ];
    }
  }

  async crawl() {
    try {
      console.log('开始抓取文章...');
      let allArticles = [];

      for (const source of this.rssSources) {
        try {
          console.log(`正在从 ${source.name} 抓取...`);
          if (!source.url) {
            console.log(`跳过 ${source.name}: 未找到 RSS URL`);
            continue;
          }

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