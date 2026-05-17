const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setup() {
  const rootPassword = process.env.DB_ROOT_PASSWORD;
  if (!rootPassword) {
    console.error('错误: 请在 .env 文件中设置 DB_ROOT_PASSWORD (root密码)');
    process.exit(1);
  }

  let rootConn;
  try {
    rootConn = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: 'root',
      password: rootPassword
    });
    console.log('✓ Root 连接成功');
  } catch (err) {
    console.error('✗ Root 连接失败:', err.message);
    console.error('请检查 .env 中 DB_ROOT_PASSWORD 是否正确');
    process.exit(1);
  }

  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME;

  try {
    // 创建数据库
    await rootConn.execute(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`✓ 数据库 ${dbName} 已就绪`);

    // 创建用户（删除旧用户如果存在）
    try {
      await rootConn.execute(`DROP USER IF EXISTS '${dbUser}'@'%'`);
      await rootConn.execute(`DROP USER IF EXISTS '${dbUser}'@'localhost'`);
    } catch (e) { /* 忽略 */ }

    await rootConn.execute(
      `CREATE USER '${dbUser}'@'%' IDENTIFIED BY '${dbPassword}'`
    );
    await rootConn.execute(
      `CREATE USER '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}'`
    );
    console.log(`✓ 用户 ${dbUser} 已创建`);

    // 授权
    await rootConn.execute(
      `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'%'`
    );
    await rootConn.execute(
      `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'localhost'`
    );
    await rootConn.execute('FLUSH PRIVILEGES');
    console.log('✓ 权限已授予');

    await rootConn.end();
  } catch (err) {
    console.error('✗ 初始化失败:', err.message);
    await rootConn.end();
    process.exit(1);
  }

  // 用新用户连接，执行建表和数据初始化
  let userConn;
  try {
    userConn = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      multipleStatements: true
    });

    const sql = fs.readFileSync(
      path.join(__dirname, 'init-db.sql'),
      'utf8'
    );

    await userConn.query(sql);
    console.log('✓ 表结构和默认数据已导入');

    await userConn.end();
    console.log('\n🎉 数据库初始化完成!');
    console.log('现在可以删除 .env 中的 DB_ROOT_PASSWORD 行（可选）');
  } catch (err) {
    console.error('✗ 建表失败:', err.message);
    process.exit(1);
  }
}

setup();
