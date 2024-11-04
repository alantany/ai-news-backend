const mongoose = require('mongoose');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const Article = require('../models/Article');
require('dotenv').config();

class ArxivFetcher {
  async processRssItem(item) {
    try {
      const arxivId = item.id[0].match(/\d{4}\.\d{5}/)?.[0];
      if (!arxivId) {
        console.log('无法获取 arXiv ID');
        return null;
      }

      console.log('获取 arXiv 文章:', arxivId);
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

      console.log('内容处理结果:', {
        hasAbstract: !!abstract,
        abstractLength: abstract.length,
        contentParts: contentParts.length,
        contentLength: content.length
      });

      return {
        title: item.title[0],
        content: content,
        summary: abstract,
        url: item.id[0],
        publishDate: new Date(item.published),
        source: 'arXiv RAG Papers'
      };
    } catch (error) {
      console.error('处理文章失败:', error);
      return null;
    }
  }

  async fetch(startDate, endDate) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('\n============= 开始抓取文章 =============');
      console.log('数据库连接成功');

      // 构建查询URL
      const query = 'all:"Retrieval+Augmented+Generation"+OR+all:RAG';
      const dateQuery = startDate ? 
        `+AND+submittedDate:[${startDate}+TO+${endDate || startDate}]` : '';
      
      const url = `http://export.arxiv.org/api/query?search_query=${query}${dateQuery}&sortBy=submittedDate&sortOrder=descending&max_results=100`;
      
      console.log('请求URL:', url);
      const response = await fetch(url);
      const data = await response.text();

      // 解析XML
      const feed = await new Promise((resolve) => {
        require('xml2js').parseString(data, (err, result) => {
          resolve(result?.feed?.entry || []);
        });
      });

      console.log(`找到 ${feed.length} 篇文章`);

      // 处理每篇文章
      let savedCount = 0;
      for (const item of feed) {
        const processedArticle = await this.processRssItem(item);
        if (processedArticle) {
          try {
            // 检查文章是否已存在
            const existingArticle = await Article.findOne({ url: processedArticle.url });
            if (!existingArticle) {
              await Article.create(processedArticle);
              console.log('保存成功:', processedArticle.title);
              savedCount++;
            } else {
              console.log('文章已存在，跳过:', processedArticle.title);
            }
          } catch (error) {
            console.error('保存失败:', error);
          }
        }
        // 添加延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`\n抓取完成，共保存 ${savedCount} 篇新文章`);
      await mongoose.disconnect();

    } catch (error) {
      console.error('抓取失败:', error);
      await mongoose.disconnect();
    }
  }
}

// 运行脚本
const fetcher = new ArxivFetcher();
const [startDate, endDate] = process.argv.slice(2);

if (!startDate) {
  console.log('请提供开始日期，格式: YYYY-MM-DD');
  process.exit(1);
}

console.log('开始抓取文章:', {
  startDate,
  endDate: endDate || startDate
});

fetcher.fetch(startDate, endDate)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('执行失败:', error);
    process.exit(1);
  }); 