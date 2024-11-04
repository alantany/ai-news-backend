const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  preArticlesPerSource: {
    type: Number,
    default: 20
  },
  crawlInterval: {
    type: Number,
    default: 60
  },
  autoCrawl: {
    type: Boolean,
    default: true
  },
  lastCrawlTime: Date,
  nextCrawlTime: Date,
  keywords: [String]
});

module.exports = mongoose.model('Setting', settingSchema); 