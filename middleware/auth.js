const jwt = require('jsonwebtoken');

// Middleware to check authentication and role
function requireRole(roles) {
  return (req, res, next) => {
    // Check for token in cookie (primary method for HTTP-only cookie auth)
    let token = req.cookies?.auth_token;
    
    // Fallback: Check Authorization header (for backward compatibility)
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        token = authHeader.split(' ')[1];
      }
    }
    
    if (!token) {
      return res.status(401).json({ 
        success: false,
        error: 'No token provided',
        message: 'Authentication required'
      });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      
      // Check if user has required role
      if (!roles.includes(decoded.role)) {
        return res.status(403).json({ 
          success: false,
          error: 'Forbidden: insufficient privileges',
          message: 'You do not have permission to access this resource'
        });
      }
      
      next();
    } catch (err) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid token',
        message: 'Authentication failed'
      });
    }
  };
}

module.exports = { requireRole };
