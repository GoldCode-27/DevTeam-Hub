import dotenv from 'dotenv';
import path from 'path';

// 1. Load environment variables before executing other modules
dotenv.config({ path: path.resolve(import.meta.dirname, '.env') });

// 2. Import configured Express app and initiate MySQL database connection pool
import app from './src/app.js';
import './src/config/db.js';

// 3. Define target network port (defaults to 8080 per API specification)
const PORT = process.env.PORT || 8080;

/**
 * 4. Start HTTP Server Listener
 * Binds the Express application to the specified network port to begin accepting traffic.
 */
const server = app.listen(PORT, () => {
  console.log(`Server: DevTeam-Hub API is live on http://localhost:${PORT}`);
  console.log(`Health Check: Available at http://localhost:${PORT}/health`);
});

/**
 * 5. Graceful Shutdown Handling (SIGTERM)
 * Ensures active HTTP requests and database connections complete cleanly
 * before the Node.js process terminates in production/container environments.
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM: Shutting down server gracefully...');
  server.close(() => {
    console.log('Process terminated.');
  });
});