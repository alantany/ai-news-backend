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

module.exports = mongoose.model('Article', articleSchema); 