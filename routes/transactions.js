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
    try {
      let bookings = [];
      let barSales = [];
      
      // Fetch bookings with error handling
      try {
        const bookingsResult = await supabase.from('bookings').select('*');
        if (bookingsResult.error) {
          console.error('Bookings fetch error:', bookingsResult.error);
        } else {
          bookings = bookingsResult.data || [];
        }
      } catch (bookingErr) {
        console.error('Bookings fetch exception:', bookingErr);
      }
      
      // Fetch bar sales with error handling  
      try {
        const barSalesResult = await supabase.from('bar_sales').select('*');
        if (barSalesResult.error) {
          console.error('Bar sales fetch error:', barSalesResult.error);
        } else {
          barSales = barSalesResult.data || [];
        }
      } catch (barSalesErr) {
        console.error('Bar sales fetch exception:', barSalesErr);
      }

      // Combine and format transactions
      const allTransactions = [];
      
      // Add bookings as transactions
      if (bookings) {
        bookings.forEach(booking => {
          allTransactions.push({
            id: `booking_${booking.id}`,
            type: 'booking',
            amount: booking.amount_paid || 0,
            description: `Room booking - ${booking.room_number || 'N/A'}`,
            created_at: booking.check_in || booking.created_at || booking.booking_date,
            transaction_date: booking.check_in || booking.created_at || booking.booking_date,
            reference: booking.room_number,
            status: booking.status || 'completed'
          });
        });
      }
      
      // Add bar sales as transactions
      if (barSales) {
        barSales.forEach(sale => {
          allTransactions.push({
            id: `sale_${sale.id}`,
            type: 'bar_sale',
            amount: sale.amount || 0,
            description: `Bar sale - ${sale.drink_name || 'N/A'}`,
            created_at: sale.date || sale.created_at,
            transaction_date: sale.date || sale.created_at,
            reference: sale.drink_name,
            quantity: sale.quantity,
            status: 'completed'
          });
        });
      }
      
      // Sort by date (newest first)
      allTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      res.json({ 
        success: true,
        data: allTransactions,
        message: 'Transactions retrieved successfully'
      });
    } catch (error) {
      console.error('Get transactions error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
      });
    }
  }
);

module.exports = router;
