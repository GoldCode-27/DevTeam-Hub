import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

/**
 * MySQL Connection Pool Configuration (ES6 Module)
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

(async () => {
  try {
    const connection = await pool.getConnection();
    console.log(' Database: MySQL Connection Pool established successfully.');
    connection.release();
  } catch (error) {
    console.error(' [Database Connection Failed]:', error.message);
  }
})();

export default pool;