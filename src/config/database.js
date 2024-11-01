const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

const connectDB = async (retries = 5) => {
  try {
    console.log('正在连接到 MongoDB...');
    console.log('MongoDB URI:', process.env.MONGODB_URI.replace(/:[^:]*@/, ':****@'));

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      retryWrites: true
    });

    console.log('MongoDB 连接成功');
    console.log('数据库名称:', conn.connection.name);
    console.log('数据库主机:', conn.connection.host);
    
    return conn;
  } catch (error) {
    console.error('MongoDB 连接失败:', error);
    console.error('错误详情:', {
      name: error.name,
      message: error.message,
      code: error.code
    });
    
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