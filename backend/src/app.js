const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const errorHandler = require('./middlewares/errorMiddleware');
const notFoundHandler = require('./middlewares/notFoundMiddleware');

const app = express();

/**
 * Global Middlewares
 */
// 1. Security HTTP Headers
app.use(helmet());

// 2. Cross-Origin Resource Sharing (Allows React Frontend to communicate)
app.use(cors({
  origin: true,
  credentials: true
}));

// 3. HTTP Request Logging (Inspect API calls in development)
app.use(morgan('dev'));

// 4. Body Parser (Accept JSON payloads)
app.use(express.json());

/**
 * Base Health Check Route
 * Verifies the API server is alive and responding
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime())
  });
});

/**
 * 404 Fallback for unhandled routes
 */
app.use(notFoundHandler);

/**
 * Centralized Global Error Handler
 */
app.use(errorHandler);

module.exports = app;