const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://checkout.flutterwave.com", "https://*.flutterwave.com", "https://*.f4b-flutterwave.com", "data:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://*.flutterwave.com", "https://*.f4b-flutterwave.com", "https://smile-t-backend.onrender.com", "wss:", "https://*.smile-tcontinental.com"],
      frameSrc: ["'self'", "https://*.flutterwave.com", "https://*.f4b-flutterwave.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:", "https:"]
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://smile-t-continental.vercel.app',
    'http://smile-tcontinental.com',
    'http://www.smile-tcontinental.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Handle preflight requests
app.options('*', cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Smile-T Continental Backend API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
try {
  // Authentication routes
  app.use('/auth', require('./routes/auth'));
  
  // Staff management routes
  app.use('/staff', require('./routes/staff'));
  
  // Room inventory routes (room type inventory system)
  app.use('/room-inventory', require('./routes/room-inventory'));
  
  // Booking routes
  app.use('/bookings', require('./routes/bookings'));
  
  // Drinks management routes
  app.use('/drinks', require('./routes/drinks'));
  
  // Bar sales routes
  app.use('/bar-sales', require('./routes/bar-sales'));
  
  // Settings routes
  app.use('/settings', require('./routes/settings'));
  
  // Transactions routes
  app.use('/transactions', require('./routes/transactions'));
  
  // Payment routes
  app.use('/payments', require('./routes/flutterwave'));
  
  console.log(' All routes loaded successfully');
} catch (error) {
  console.error(' Error loading routes:', error.message);
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Handle different types of errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON format'
    });
  }
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'File too large'
    });
  }
  
  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Handle 404 routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    availableRoutes: [
      'GET /health',
      'POST /auth/login',
      'GET /staff',
      'GET /room-inventory',
      'GET /bookings',
      'GET /drinks',
      'GET /analytics',
      'POST /payments/initiate'
    ]
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log('===============================================');
  console.log(`Smile-T Continental Backend Server Started`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('===============================================');
  
  // Log available endpoints
  console.log('\n Available API Endpoints:');
  console.log('  Health Check: GET /health');
  console.log('  Authentication: POST /api/auth/login');
  console.log('  Staff: GET|POST|PUT|DELETE /api/staff');
  console.log('  Room Inventory: GET|POST|PUT|DELETE /api/room-inventory');
  console.log('  Bookings: GET|POST|PUT|DELETE /api/bookings');
  console.log('  Drinks: GET|POST|PUT|DELETE /api/drinks');
  console.log('  Analytics: GET /api/analytics');
  console.log('  Reports: GET /api/reports');
  console.log('  Payments: POST /api/payments/initiate');
  console.log('===============================================\n');
});

// Export app for testing
module.exports = app;
