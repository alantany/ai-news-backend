const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  crawlInterval: {
    type: Number,
    default: 60,
    required: true
  },
  preArticlesPerSource: {
    type: Number,
    default: 10,
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
  },
  keywords: {
    type: Map,
    of: [String],
    default: () => ({
      'LLM': ['GPT', 'Large Language Model', 'ChatGPT', 'Claude'],
      'RAG': ['Retrieval Augmented Generation'],
      'TRAINING': ['Fine-tuning', 'Training', 'Pre-training'],
      'APPLICATIONS': ['Applications', 'Use Cases', 'Implementation'],
      'TOOLS': ['Tools', 'Libraries', 'Frameworks'],
      'COMPANIES': ['OpenAI', 'Anthropic', 'Google', 'Microsoft']
    })
  }
});

settingSchema.set('toJSON', {
  transform: (doc, ret) => {
    if (ret.keywords instanceof Map) {
      ret.keywords = Object.fromEntries(ret.keywords);
    }
    return ret;
  }
});

module.exports = mongoose.model('Setting', settingSchema); 