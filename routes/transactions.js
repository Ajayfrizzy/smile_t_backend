const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET all transactions (bookings + bar sales)
router.get(
  '/',
  requireRole(['superadmin', 'supervisor', 'receptionist']),
  async (req, res) => {
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*');
    const { data: barSales, error: barSalesError } = await supabase
      .from('bar_sales')
      .select('*');
    if (bookingsError || barSalesError)
      return res
        .status(500)
        .json({ error: bookingsError?.message || barSalesError?.message });
    res.json({ bookings, barSales });
  }
);

module.exports = router;
