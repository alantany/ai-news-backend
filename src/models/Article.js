const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  translatedTitle: {
    type: String
  },
  translatedContent: {
    type: String
  },
  translatedSummary: {
    type: String
  },
  source: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true,
    unique: true
  },
  publishDate: {
    type: Date,
    default: Date.now
  },
  category: {
    type: String
  },
  isTranslated: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Article', articleSchema); 