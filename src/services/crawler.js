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
        name: 'VentureBeat AI',
        url: 'https://venturebeat.com/category/ai/feed/'
      }
    ];
  }

  async analyzeRelevance(title, summary) {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "你是一个AI领域的专家，需要判断文章与AI技术的相关性。重点关注：LLM、RAG、AI训练、AI应用等主题。"
          },
          {
            role: "user",
            content: `请分析以下文章与AI技术的相关性，返回0-100的分数和简短理由：\n标题：${title}\n摘要：${summary}`
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      });

      const result = response.choices[0].message.content;
      // 提取分数
      const scoreMatch = result.match(/\d+/);
      const score = scoreMatch ? parseInt(scoreMatch[0]) : 0;
      return { score, reason: result };
    } catch (error) {
      console.error('分析相关性失败:', error);
      return { score: 0, reason: '分析失败' };
    }
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
      return text;
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
            const content = item.content || item.description || '';
            const summary = this.generateSummary(content);
            
            // 分析文章相关性
            const { score, reason } = await this.analyzeRelevance(item.title, summary);
            console.log(`文章相关性分数: ${score}, 原因: ${reason}`);

            // 只处理相关性分数大于60的文章
            if (score > 60) {
              const title = await this.translateText(item.title);
              const translatedSummary = await this.translateText(summary);

              const article = {
                title,
                content,
                summary: translatedSummary,
                source: source.name,
                url: item.link || item.guid,
                publishDate: new Date(item.pubDate || item.isoDate),
                category: 'AI',
                relevanceScore: score,
                relevanceReason: reason,
                likes: 0,
                views: 0
              };

              allArticles.push(article);
            }
          }
        } catch (error) {
          console.error(`从 ${source.name} 抓取失败:`, error);
          continue;
        }
      }

      // 按相关性分数和发布日期排序
      allArticles.sort((a, b) => {
        if (b.relevanceScore !== a.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return b.publishDate - a.publishDate;
      });

      // 保存到数据库
      console.log(`开始保存 ${allArticles.length} 篇文章到数据库...`);
      const savedArticles = [];
      for (const article of allArticles) {
        try {
          // 使用 findOne 先检查文章是否已存在
          const existingArticle = await Article.findOne({ url: article.url });
          if (!existingArticle) {
            // 如果文章不存在，则创建新文章
            const savedArticle = await Article.create(article);
            console.log(`新文章保存成功: ${savedArticle.title}`);
            savedArticles.push(savedArticle);
          } else {
            console.log(`文章已存在，跳过: ${article.title}`);
          }
        } catch (error) {
          console.error(`文章保存失败:`, error);
          console.error('文章数据:', article);
        }
      }
      console.log(`所有文章保存完成，成功保存 ${savedArticles.length} 篇新文章`);

      return savedArticles;
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