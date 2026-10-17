const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = require('./src/app');
// Initialize the MySQL connection pool
require('./src/config/db');

const PORT = process.env.PORT || 8080;

/**
 * Start Express HTTP Server
 */
const server = app.listen(PORT, () => {
  console.log(` [Server]: DevTeam-Hub API is live on http://localhost:${PORT}`);
  console.log(` [Health Check]: Available at http://localhost:${PORT}/health`);
});

/**
 * Graceful Shutdown Handling
 */
process.on('SIGTERM', () => {
  console.log(' [SIGTERM]: Shutting down server gracefully...');
  server.close(() => {
    console.log(' Process terminated.');
  });
});