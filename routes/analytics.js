const express = require('express');
const router = express.Router();
const { cache } = require('../utils/cache');
const { requireRole } = require('../middleware/auth');

// Track endpoint access counts
const accessStats = {
    endpoints: {},
    lastReset: new Date(),
    recordAccess: function(path) {
        this.endpoints[path] = (this.endpoints[path] || 0) + 1;
    }
};

// Middleware to track endpoint access
router.use((req, res, next) => {
    accessStats.recordAccess(req.path);
    next();
});

// Get system health metrics
router.get('/system-health', requireRole(['admin', 'manager']), (req, res) => {
    const used = process.memoryUsage();
    const systemInfo = {
        memory: {
            heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100 + 'MB',
            heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100 + 'MB',
            rss: Math.round(used.rss / 1024 / 1024 * 100) / 100 + 'MB',
            external: Math.round(used.external / 1024 / 1024 * 100) / 100 + 'MB',
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        platform: process.platform,
        nodeVersion: process.version
    };

    res.json({
        success: true,
        data: systemInfo
    });
});

// Get cache performance metrics
router.get('/cache-performance', requireRole(['admin', 'manager']), (req, res) => {
    const stats = cache.getStats();
    const keys = cache.keys();
    
    const cacheInfo = {
        stats: {
            hits: stats.hits,
            misses: stats.misses,
            hitRate: stats.hits / (stats.hits + stats.misses || 1),
            keys: keys.length
        },
        breakdown: {
            bookings: keys.filter(k => k.startsWith('booking')).length,
            rooms: keys.filter(k => k.startsWith('room')).length,
            drinks: keys.filter(k => k.startsWith('drink')).length,
            barSales: keys.filter(k => k.startsWith('bar_sales')).length
        },
        keys: keys // List of all cache keys
    };

    res.json({
        success: true,
        data: cacheInfo
    });
});

// Get most accessed endpoints
router.get('/access-patterns', requireRole(['admin', 'manager']), (req, res) => {
    const sortedEndpoints = Object.entries(accessStats.endpoints)
        .sort(([, a], [, b]) => b - a)
        .reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
        }, {});

    res.json({
        success: true,
        data: {
            endpoints: sortedEndpoints,
            totalAccesses: Object.values(accessStats.endpoints).reduce((a, b) => a + b, 0),
            trackingSince: accessStats.lastReset
        }
    });
});

// Reset access statistics
router.post('/reset-stats', requireRole(['admin']), (req, res) => {
    accessStats.endpoints = {};
    accessStats.lastReset = new Date();
    
    res.json({
        success: true,
        message: 'Access statistics reset successfully'
    });
});

// Clear specific cache entries
router.post('/clear-cache', requireRole(['admin']), (req, res) => {
    const { pattern } = req.body;
    
    if (pattern) {
        const keys = cache.keys();
        const regex = new RegExp(pattern);
        let cleared = 0;
        
        keys.forEach(key => {
            if (regex.test(key)) {
                cache.del(key);
                cleared++;
            }
        });
        
        res.json({
            success: true,
            message: `Cleared ${cleared} cache entries matching pattern: ${pattern}`
        });
    } else {
        cache.flushAll();
        res.json({
            success: true,
            message: 'Cleared all cache entries'
        });
    }
});
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: 'Too many requests, please try again later.' });
router.use(limiter);

// GET analytics summary
router.get('/', async (req, res) => {
  try {
    // Get all required data
    const { data: bookings, error: bookingsError } = await supabase.from('bookings').select('*');
    const { data: barSales, error: barSalesError } = await supabase.from('bar_sales').select('*');
    const { data: roomInventory, error: roomsError } = await supabase.from('room_inventory').select('*');
    
    if (bookingsError || barSalesError || roomsError) {
      console.error('Analytics data fetch error:', bookingsError || barSalesError || roomsError);
      return res.status(500).json({ 
        success: false,
        error: bookingsError?.message || barSalesError?.message || roomsError?.message
      });
    }

    const totalBookings = bookings?.length || 0;
    
    // Calculate total revenue from bookings and bar sales  
    const bookingRevenue = (bookings || []).reduce((sum, b) => sum + (b.total_amount || b.amount_paid || 0), 0);
    const barSalesRevenue = (barSales || []).reduce((sum, s) => sum + (s.total_amount || s.amount || 0), 0);
    const totalRevenue = bookingRevenue + barSalesRevenue;
    
    // Calculate occupancy rate
    const totalRooms = (roomInventory || []).reduce((sum, room) => sum + (room.total_rooms || 0), 0);
    const today = new Date().toISOString().split('T')[0]; // Current date in YYYY-MM-DD format
    
    // Count currently occupied rooms (bookings that include today)
    const currentOccupiedRooms = (bookings || []).filter(booking => {
      const checkIn = new Date(booking.check_in);
      const checkOut = new Date(booking.check_out);
      const todayDate = new Date(today);
      
      return booking.status === 'confirmed' && 
             checkIn <= todayDate && 
             checkOut > todayDate;
    }).length;
    
    const occupancyRate = totalRooms > 0 ? (currentOccupiedRooms / totalRooms) * 100 : 0;
    const totalBarSales = barSalesRevenue;

    res.json({ 
      success: true,
      data: { 
        totalBookings, 
        totalRevenue, 
        occupancyRate: Math.round(occupancyRate * 10) / 10, // Round to 1 decimal place
        totalBarSales,
        totalRooms,
        occupiedRooms: currentOccupiedRooms
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// GET analytics overview - specific endpoint frontend expects
router.get('/overview', async (req, res) => {
  try {
    // Get all required data
    const { data: bookings, error: bookingsError } = await supabase.from('bookings').select('*');
    const { data: barSales, error: barSalesError } = await supabase.from('bar_sales').select('*');
    const { data: roomInventory, error: roomsError } = await supabase.from('room_inventory').select('*');
    
    if (bookingsError || barSalesError || roomsError) {
      console.error('Analytics data fetch error:', bookingsError || barSalesError || roomsError);
      return res.status(500).json({ 
        success: false,
        error: bookingsError?.message || barSalesError?.message || roomsError?.message
      });
    }

    const totalBookings = bookings?.length || 0;
    
    // Calculate total revenue from bookings and bar sales
    const bookingRevenue = (bookings || []).reduce((sum, b) => sum + (b.total_amount || b.amount_paid || 0), 0);
    const barSalesRevenue = (barSales || []).reduce((sum, s) => sum + (s.total_amount || s.amount || 0), 0);
    const totalRevenue = bookingRevenue + barSalesRevenue;
    
    // Calculate occupancy rate
    const totalRooms = (roomInventory || []).reduce((sum, room) => sum + (room.total_rooms || 0), 0);
    const today = new Date().toISOString().split('T')[0]; // Current date in YYYY-MM-DD format
    
    // Count currently occupied rooms (bookings that include today)
    const currentOccupiedRooms = (bookings || []).filter(booking => {
      const checkIn = new Date(booking.check_in);
      const checkOut = new Date(booking.check_out);
      const todayDate = new Date(today);
      
      return booking.status === 'confirmed' && 
             checkIn <= todayDate && 
             checkOut > todayDate;
    }).length;
    
    const occupancyRate = totalRooms > 0 ? (currentOccupiedRooms / totalRooms) * 100 : 0;
    const totalBarSales = barSalesRevenue;

    res.json({ 
      success: true,
      data: { 
        totalBookings, 
        totalRevenue, 
        occupancyRate: Math.round(occupancyRate * 10) / 10, // Round to 1 decimal place
        totalBarSales,
        totalRooms,
        occupiedRooms: currentOccupiedRooms
      }
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

module.exports = router;
