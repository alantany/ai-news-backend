const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  title: String,
  translatedTitle: String,
  content: String,
  translatedContent: String,
  summary: String,
  translatedSummary: String,
  source: String,
  url: String,
  publishDate: Date,
  isTranslated: Boolean,
  likes: { type: Number, default: 0 },
  reads: { type: Number, default: 0 },
  stars: { type: Number, default: 0 },
  shares: { type: Number, default: 0 }
}, {
  timestamps: true
});

// 添加索引
articleSchema.index({ publishDate: -1 }); // 发布日期索引
articleSchema.index({ isTranslated: 1 }); // 翻译状态索引
articleSchema.index({ title: 'text', translatedTitle: 'text' }); // 文本搜索索引

const Article = mongoose.model('Article', articleSchema);

// 创建索引
async function createIndexes() {
  try {
    await Article.createIndexes();
    console.log('文章索引创建成功');
  } catch (error) {
    console.error('创建索引失败:', error);
  }
}

createIndexes();

module.exports = Article; 