const mongoose = require('mongoose');
const crypto = require('crypto');

const adminSchema = new mongoose.Schema({
  password: {
    type: String,
    required: true
  },
  isFirstLogin: {
    type: Boolean,
    default: true
  }
});

// 静态方法：密码哈希
adminSchema.statics.hashPassword = function(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
};

module.exports = mongoose.model('Admin', adminSchema); 