const mongoose = require('mongoose');

const connectDB = async (retries = 5) => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      retryWrites: true
    });

    console.log('MongoDB 连接成功');
    return conn;
  } catch (error) {
    console.error('MongoDB 连接失败:', error);
    
    if (retries > 0) {
      console.log(`还剩 ${retries} 次重试机会，5秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return connectDB(retries - 1);
    } else {
      console.error('MongoDB 连接重试次数用完，退出程序');
      process.exit(1);
    }
  }
};

module.exports = connectDB; 