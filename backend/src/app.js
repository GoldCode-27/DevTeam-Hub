import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import apiRoutes from './routes/index.js';
import errorHandler from './middlewares/errorMiddleware.js';
import notFoundHandler from './middlewares/notFoundMiddleware.js';

/**
 * Express Application Configuration
 * Central pipeline that mounts security, parsing, logging, routes, and error handling.
 */
const app = express();

// 1. Security Headers: Sets secure HTTP response headers against common web vulnerabilities
app.use(helmet());

// 2. Cross-Origin Resource Sharing: Allows the React frontend to communicate with port 8080
app.use(cors({
  origin: true,
  credentials: true
}));

// 3. HTTP Request Logging: Outputs method, path, status, and response time to the terminal
app.use(morgan('dev'));

// 4. Body Parser: Parses incoming request payloads formatted as JSON into req.body
app.use(express.json());



/**
 * Server Health Check Endpoint
 * Allows monitoring services and developers to verify the server is live and responding.
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime())
  });
});

// Central API Routes (All modules prefixed with /api)
app.use('/api', apiRoutes);

// 1. 404 Handler: Catches all unmatched routes that slipped past previous endpoints
app.use(notFoundHandler);

// 2. Global Error Handler: Catches all operational errors and sends standardized JSON responses
app.use(errorHandler);

/**
 * Export configured app instance
 * Kept separate from server.js to allow integration testing without binding network ports.
 */
export default app;