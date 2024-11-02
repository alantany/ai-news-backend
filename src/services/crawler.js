const Parser = require('rss-parser');
const Article = require('../models/Article');
const OpenAI = require('openai');
const Setting = require('../models/Setting');

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

    // 定义文章类型及其关键词权重
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
  }

  calculateArticleScore(title, content) {
    let maxScore = 0;
    let category = 'GENERAL_AI';

    // 将标题和内容合并为一个文本进行检索
    const text = `${title} ${content}`.toLowerCase();

    // 遍历每个分类的关键词
    for (const [cat, config] of Object.entries(this.articleCategories)) {
      for (const keyword of config.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          const score = config.weight;
          if (score > maxScore) {
            maxScore = score;
            category = cat;
          }
        }
      }
    }

    return {
      score: maxScore,
      category
    };
  }

  async crawl() {
    try {
      console.log('开始抓取文章...');
      let allArticles = [];

      for (const source of this.rssSources) {
        try {
          console.log(`正在从 ${source.name} 抓取...`);
          const feed = await this.parser.parseURL(source.url);
          
          // 处理每篇文章，添加分数和分类
          const scoredArticles = feed.items.map(item => {
            const { score, category } = this.calculateArticleScore(
              item.title,
              item.content || item.description || ''
            );
            return {
              ...item,
              score,
              category
            };
          });

          allArticles.push(...scoredArticles);
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
            const translatedTitle = await this.translateText(article.title);
            const translatedContent = await this.translateText(article.content || article.description);
            const summary = this.generateSummary(article.content || article.description);
            const translatedSummary = await this.translateText(summary);

            const savedArticle = await Article.create({
              title: translatedTitle,
              content: translatedContent,
              summary: translatedSummary,
              source: article.source,
              url: article.link,
              publishDate: new Date(article.pubDate || article.isoDate),
              category: article.category
            });

            console.log(`保存新文章: ${translatedTitle} (${article.category})`);
            savedArticles.push(savedArticle);
          }
        } catch (error) {
          console.error(`文章处理失败:`, error);
        }
      }

      console.log(`本次抓取完成，成功保存 ${savedArticles.length} 篇文章`);
      return savedArticles;
    } catch (error) {
      console.error('抓取文章失败:', error);
      throw error;
    }
  }

  async translateText(text) {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "你是一个专业的中文翻译，需要将英文文章翻译成通顺的中文。保持专业术语的准确性。"
          },
          {
            role: "user",
            content: `请将以下内容翻译成中文：\n${text}`
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('翻译失败:', error);
      throw error;
    }
  }

  generateSummary(content) {
    // 简单的摘要生成逻辑，可以根据需要调整
    return content.substring(0, 200);
  }
}

module.exports = new CrawlerService();