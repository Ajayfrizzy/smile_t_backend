const NodeCache = require('node-cache');

// Cache configuration
const cache = new NodeCache({
    stdTTL: 300, // 5 minutes default TTL
    checkperiod: 600, // Check for expired entries every 10 minutes
    useClones: false, // For better performance
    maxKeys: 1000 // Prevent memory leaks
});

// Cache middleware factory
const cacheMiddleware = (key, duration = 300) => {
    return (req, res, next) => {
        // For dynamic routes, generate a key based on params/query
        const finalKey = typeof key === 'function' ? key(req) : key;
        
        // Try to get cached data
        const cachedData = cache.get(finalKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        // Override res.json to cache the response
        const originalJson = res.json;
        res.json = function(data) {
            cache.set(finalKey, data, duration);
            return originalJson.call(this, data);
        };

        next();
    };
};

// Cache invalidation helper
const invalidateCache = (patterns) => {
    if (!Array.isArray(patterns)) patterns = [patterns];
    
    const keys = cache.keys();
    patterns.forEach(pattern => {
        const regex = new RegExp(pattern);
        keys.forEach(key => {
            if (regex.test(key)) {
                cache.del(key);
            }
        });
    });
};

module.exports = {
    cache,
    cacheMiddleware,
    invalidateCache
};