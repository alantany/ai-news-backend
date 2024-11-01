const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  crawlInterval: {
    type: Number,
    default: 240,
    required: true
  },
  preArticlesPerSource: {
    type: Number,
    default: 20,
    required: true
  },
  finalArticlesCount: {
    type: Number,
    default: 5,
    required: true
  },
  autoCrawl: {
    type: Boolean,
    default: false,
    required: true
  },
  lastCrawlTime: {
    type: Date
  }
});

module.exports = mongoose.model('Setting', settingSchema); 