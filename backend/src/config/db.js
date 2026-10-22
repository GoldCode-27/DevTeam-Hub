// Import the MySQL module with Promise support for async/await.
import mysql from 'mysql2/promise';

// Import dotenv to load environment variables from a .env file.
import dotenv from 'dotenv';

// Load environment variables from the .env file.
// import.meta.dirname gives the directory of the current module.
// path.resolve() builds an absolute path to the .env file.
// '../../.env' means go up two directories, then find .env.
dotenv.config({
});

/**
 * MySQL Connection Pool Configuration.
 * A connection pool manages multiple database connections.
 * It allows the application to reuse connections efficiently.
 */
const pool = mysql.createPool({

  // Read the database host from .env; use localhost if not provided.
  host: process.env.DB_HOST || 'localhost',

  // Read the database username from .env; default to root.
  user: process.env.DB_USER || 'root',

  // Read the database password from .env; default to an empty string.
  password: process.env.DB_PASSWORD || '',

  // Read the database name from .env; default to devteam_hub.
  database: process.env.DB_NAME || 'devteam_hub',

  // Convert the database port to a number; default to MySQL port 3306.
  port: Number(process.env.DB_PORT) || 3306,

  // Allow the pool to wait when all connections are busy.
  waitForConnections: true,

  // Allow the pool to maintain up to 10 connections at a time.
  connectionLimit: 10,

  // Allow an unlimited number of waiting requests in the queue.
  queueLimit: 0,

  // Enable TCP Keep-Alive to help maintain network connections.
  enableKeepAlive: true,

  // Start Keep-Alive immediately without an initial delay.
  keepAliveInitialDelay: 0
});

// Create an asynchronous function and run it immediately.
// This checks whether the application can connect to the database.
(async () => {
  try {

    // Request a connection from the MySQL connection pool.
    const connection = await pool.getConnection();

    // Print a success message if a connection is obtained.
    console.log(
      'Database: MySQL Connection Pool established successfully.'
    );

    // Release the connection back to the pool so it can be reused.
    connection.release();

  } catch (error) {

    // Print an error message if the connection attempt fails.
    console.error('[Database Connection Failed]:', error.message);
  }
})();

async function safeQuery(sql, params) {
  const rows = await pool.execute(sql, params);
  return rows[0];
}

// Export the pool so other files can import and use it.
export default { pool, safeQuery };