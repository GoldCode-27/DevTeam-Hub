import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dirname, '.env') });

import app from './src/app.js';
import './src/config/db.js';

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(` Server: DevTeam-Hub API is live on http://localhost:${PORT}`);
  console.log(` Health Check: Available at http://localhost:${PORT}/health`);
});

process.on('SIGTERM', () => {
  console.log(' SIGTERM: Shutting down server gracefully...');
  server.close(() => {
    console.log(' Process terminated.');
  });
});