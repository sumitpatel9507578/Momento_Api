const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,

  waitForConnections: true,
  connectionLimit: 5,
  maxIdle: 5,
  idleTimeout: 60000,
  queueLimit: 0,
  connectTimeout: 20000, // 20 seconds for slow remote connections
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

module.exports = db;
