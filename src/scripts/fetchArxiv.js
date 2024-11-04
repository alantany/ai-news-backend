const mongoose = require('mongoose');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const Article = require('../models/Article');
require('dotenv').config();

class ArxivFetcher {
  constructor() {
    this.baseUrl = 'http://export.arxiv.org/api/query';
  }

  // 生成查询URL
  buildQueryUrl(startDate, endDate, start = 0) {
    const query = 'all:"Retrieval+Augmented+Generation"+OR+all:RAG';
    const url = new URL(this.baseUrl);
    url.searchParams.append('search_query', query);
    url.searchParams.append('sortBy', 'submittedDate');
    url.searchParams.append('sortOrder', 'descending');
    url.searchParams.append('start', start);
    url.searchParams.append('max_results', 100);

    if (startDate) {
      url.searchParams.append('submittedDate', `[${startDate}+TO+${endDate || startDate}]`);
    }

    return url.toString();
  }

  // 处理单篇文章
  async processArticle(item) {
    try {
      const arxivId = item.id.match(/\d{4}\.\d{5}/)?.[0];
      if (!arxivId) {
        console.log('无法获取 arXiv ID');
        return null;
      }

      console.log('处理文章:', arxivId);
      const htmlUrl = `https://arxiv.org/html/${arxivId}`;
      const response = await fetch(htmlUrl);
      const html = await response.text();
      const $ = cheerio.load(html);

      // 提取摘要
      const abstract = $('.abstract').text()
        .replace('Abstract:', '')
        .trim();

      // 提取正文
      let contentParts = [];
      $('.ltx_section').each((i, section) => {
        const $section = $(section);
        const title = $section.find('.ltx_title').first().text().trim();
        
        if (title) {
          contentParts.push(`### ${title}\n\n`);
        }

        $section.find('p').each((j, p) => {
          const text = $(p).text().trim();
          if (text) {
            contentParts.push(`${text}\n\n`);
          }
        });
      });

      const content = contentParts.join('');

      return {
        title: item.title[0],
        content: content,
        summary: abstract,
        url: item.id,
        publishDate: new Date(item.published),
        source: 'arXiv RAG Papers'
      };
    } catch (error) {
      console.error('处理文章失败:', error);
      return null;
    }
  }

  // 主抓取函数
  async fetch(startDate, endDate) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('数据库连接成功');

      let start = 0;
      let totalProcessed = 0;
      let hasMore = true;

      while (hasMore) {
        const url = this.buildQueryUrl(startDate, endDate, start);
        console.log(`\n请求 URL: ${url}`);

        const response = await fetch(url);
        const data = await response.text();
        const feed = await new Promise((resolve) => {
          require('xml2js').parseString(data, (err, result) => {
            resolve(result?.feed?.entry || []);
          });
        });

        if (!feed.length) {
          hasMore = false;
          continue;
        }

        console.log(`获取到 ${feed.length} 篇文章`);

        for (const item of feed) {
          const processedArticle = await this.processArticle(item);
          if (processedArticle) {
            try {
              // 检查文章是否已存在
              const existingArticle = await Article.findOne({ url: processedArticle.url });
              if (!existingArticle) {
                await Article.create(processedArticle);
                console.log('保存成功:', processedArticle.title);
                totalProcessed++;
              } else {
                console.log('文章已存在，跳过');
              }
            } catch (error) {
              console.error('保存失败:', error);
            }
          }
        }

        start += feed.length;
        console.log(`\n当前进度: 已处理 ${start} 篇文章`);
        
        // 添加延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      console.log(`\n抓取完成，共保存 ${totalProcessed} 篇新文章`);
      await mongoose.disconnect();

    } catch (error) {
      console.error('抓取失败:', error);
    }
  }
}

// 运行示例
const fetcher = new ArxivFetcher();

// 命令行参数: node fetchArxiv.js 2023-01-01 2024-01-01
const [startDate, endDate] = process.argv.slice(2);
if (!startDate) {
  console.log('请提供开始日期，格式: YYYY-MM-DD');
  process.exit(1);
}

fetcher.fetch(startDate, endDate)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('执行失败:', error);
    process.exit(1);
  }); 