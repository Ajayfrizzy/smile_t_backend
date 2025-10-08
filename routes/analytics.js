const express = require('express');
const router = express.Router();
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
