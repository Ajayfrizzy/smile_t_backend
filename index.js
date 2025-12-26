const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
require('dotenv').config();

const app = express();

// Trust proxy - CRITICAL for Railway, Render, Heroku, etc.
// Railway uses a reverse proxy, so we need to trust the X-Forwarded-* headers
app.set('trust proxy', 1);

// Enable compression
app.use(compression());

// Cookie parser (must be before CSRF)
app.use(cookieParser());

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://checkout.flutterwave.com", "https://*.flutterwave.com", "https://*.f4b-flutterwave.com", "https://cdn.mxpnl.com", "https://vercel.live", "data:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://*.flutterwave.com", "https://*.f4b-flutterwave.com", "https://api.fpjs.io", "https://metrics.flutterwave.com", "https://smile-t-tjej9.ondigitalocean.app", "https://vercel.live", "wss:", "https://*.smile-tcontinental.com"],
      frameSrc: ["'self'", "https://*.flutterwave.com", "https://*.f4b-flutterwave.com", "https://checkout-v3-ui-prod.f4b-flutterwave.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:", "https:"],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:", "https://*.flutterwave.com"]
    },
  },
}));

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'https://smile-t-continental.vercel.app',
  'https://smile-tcontinental.com',
  'https://www.smile-tcontinental.com',
  'http://smile-tcontinental.com',
  'http://www.smile-tcontinental.com',
  // Digital Ocean backend URL (for testing)
  'https://smile-t-tjej9.ondigitalocean.app'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Origin', 
    'Accept', 
    'X-Requested-With', 
    'X-CSRF-Token',
    'Cache-Control',
    'Pragma',
    'Expires',
    'If-None-Match',
    'If-Modified-Since'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'Set-Cookie'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight requests
app.options('*', cors());

// Rate limiting - Increased for staff operations
// Staff members can make up to 300 requests per 15 minutes
// This allows for frequent dashboard refreshes, booking operations, and login attempts
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Increased from 100 to 300 requests per windowMs for better staff experience
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  // Railway/Render/Heroku/DigitalOcean specific: Use the rightmost IP in X-Forwarded-For
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Trust proxy is already set above, so this will work correctly
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CSRF Protection (cookie-based)
const csrfProtection = csrf({ 
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict'
  } 
});

// CSRF token endpoint (no protection needed for getting the token)
// This must be placed BEFORE csrfProtection middleware is applied
app.get('/auth/csrf-token', csrfProtection, (req, res) => {
  // Generate and send the CSRF token
  res.json({ csrfToken: req.csrfToken() });
});

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
  
  // Analytics routes
  app.use('/analytics', require('./routes/analytics'));
  
  // Payment routes
  const flutterwaveRoutes = require('./routes/flutterwave');
  app.use('/payments', flutterwaveRoutes);
  // Legacy endpoint - mount same router at old path for backward compatibility  
  app.use('/flutterwave', flutterwaveRoutes);
  
  console.log('✅ All routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading routes:', error.message);
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
  // Log memory usage on startup
  const used = process.memoryUsage();
  console.log('===============================================');
  console.log(`Smile-T Continental Backend Server Started`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('\nInitial Memory Usage:');
  for (let key in used) {
    console.log(`${key}: ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
  }
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
