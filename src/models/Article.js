const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  title: String,
  content: String,
  summary: String,
  source: String,
  url: String,
  publishDate: Date,
  likes: Number,
  views: Number,
  category: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Article', articleSchema); 