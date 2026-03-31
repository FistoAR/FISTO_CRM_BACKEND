const mysql = require("mysql2");
require("dotenv").config();

let pool;

function createPool() {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    // connectionLimit: 3,  
    queueLimit: 0,
    connectTimeout: 10000,
    acquireTimeout: 10000,
    timeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    idleTimeout: 30000,
    maxIdle: 1
  });

  pool.on('acquire', (connection) => {
    console.log('→ Connection %d acquired', connection.threadId);
  });

  pool.on('release', (connection) => {
    console.log('← Connection %d released', connection.threadId);
  });

  pool.on('error', (err) => {
    console.error('Pool error:', err.code);
    if (err.code === 'ER_TOO_MANY_USER_CONNECTIONS') {
      console.error('❌ MAX CONNECTIONS! Restart server to clear.');
    }
  });

  pool.getConnection((err, connection) => {
    if (err) {
      console.error('❌ Connection failed:', err.message);
    } else {
      console.log('✓ Database connected');
      connection.release();
    }
  });

  return pool;
}

createPool();

function queryWithRetry(sql, params = [], retries = 1) {
  return new Promise((resolve, reject) => {
    const attemptQuery = (attemptsLeft) => {
      pool.query(sql, params, (err, results) => {
        if (err) {
          if (err.code === 'ER_TOO_MANY_USER_CONNECTIONS') {
            reject(new Error('Database busy. Try again in a moment.'));
            return;
          }
          
          if ((err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST') 
              && attemptsLeft > 0) {
            setTimeout(() => attemptQuery(attemptsLeft - 1), 500);
          } else {
            reject(err);
          }
        } else {
          resolve(results);
        }
      });
    };
    attemptQuery(retries);
  });
}

function getConnectionWithRetry(retries = 1) {
  return new Promise((resolve, reject) => {
    const attemptConnection = (attemptsLeft) => {
      pool.getConnection((err, connection) => {
        if (err) {
          if (err.code === 'ER_TOO_MANY_USER_CONNECTIONS') {
            reject(new Error('Database busy. Try again in a moment.'));
            return;
          }
          
          if ((err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST') 
              && attemptsLeft > 0) {
            setTimeout(() => attemptConnection(attemptsLeft - 1), 500);
          } else {
            reject(err);
          }
        } else {
          // Auto-release after 30 seconds safety
          const safetyTimer = setTimeout(() => {
            console.warn('⚠ Force releasing connection', connection.threadId);
            try { connection.release(); } catch(e) {}
          }, 30000);
          
          const originalRelease = connection.release.bind(connection);
          connection.release = function() {
            clearTimeout(safetyTimer);
            originalRelease();
          };
          
          resolve(connection);
        }
      });
    };
    attemptConnection(retries);
  });
}

function closePool() {
  return new Promise((resolve, reject) => {
    pool.end((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

module.exports = { 
  pool, 
  queryWithRetry, 
  getConnectionWithRetry,
  closePool
};