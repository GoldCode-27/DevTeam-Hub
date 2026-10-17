const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/**
 * MySQL Connection Pool Configuration
 * Using connection pool ensures high concurrency and prevents single-connection dropouts.
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'devteam_hub',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

/**
 * Immediate Connection Health Check
 * Verifies that XAMPP MySQL is running and credentials are valid upon server startup.
 */
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Database: MySQL Connection Pool established successfully.');
    connection.release();
  } catch (error) {
    console.error('[Database Connection Failed]:', error.message);
    console.error('Tip: Ensure XAMPP MySQL module is running and database exists.');
  }
})();

module.exports = pool;