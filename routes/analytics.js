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
  // Example: total bookings, revenue, occupancy rate, bar sales
  const { data: bookings, error: bookingsError } = await supabase.from('bookings').select('*');
  const { data: barSales, error: barSalesError } = await supabase.from('bar_sales').select('*');
  if (bookingsError || barSalesError) return res.status(500).json({ error: bookingsError?.message || barSalesError?.message });

  const totalBookings = bookings.length;
  const totalRevenue = bookings.reduce((sum, b) => sum + (b.amount_paid || 0), 0) + barSales.reduce((sum, s) => sum + (s.amount || 0), 0);
  const occupancyRate = (totalBookings / 100) * 100; // Placeholder
  const totalBarSales = barSales.reduce((sum, s) => sum + (s.amount || 0), 0);

  res.json({ totalBookings, totalRevenue, occupancyRate, totalBarSales });
});

module.exports = router;
