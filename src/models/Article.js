const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  title: String,
  content: String,
  translatedTitle: String,
  translatedContent: String,
  summary: String,
  translatedSummary: String,
  source: String,
  url: String,
  publishDate: Date,
  category: String,
  isTranslated: Boolean
}, {
  timestamps: true
});

module.exports = mongoose.model('Article', articleSchema); 