const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET all bar sales (barmen and supervisors can view)
router.get('/', requireRole(['superadmin', 'supervisor', 'barmen']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bar_sales')
      .select(`
        *,
        drinks (
          drink_name,
          price
        ),
        staff (
          name,
          staff_id
        )
      `)
      .order('created_at', { ascending: false });
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data || [],
      message: 'Bar sales retrieved successfully'
    });
  } catch (error) {
    console.error('Get bar sales error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// POST add new bar sale (barmen only)
router.post('/', requireRole(['superadmin', 'barmen']), async (req, res) => {
  try {
    const { drink_id, quantity, customer_name, payment_method } = req.body;
    const staff_id = req.user.id;
    
    // Validate required fields
    if (!drink_id || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'Drink ID and quantity are required'
      });
    }

    // Get drink details
    const { data: drink, error: drinkError } = await supabase
      .from('drinks')
      .select('drink_name, price, stock_quantity')
      .eq('id', drink_id)
      .single();

    if (drinkError || !drink) {
      return res.status(404).json({
        success: false,
        message: 'Drink not found'
      });
    }

    // Check stock availability
    if (drink.stock_quantity < quantity) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient stock'
      });
    }

    const total_amount = drink.price * quantity;

    // Create sale record
    const { data: sale, error: saleError } = await supabase
      .from('bar_sales')
      .insert([
        {
          drink_id,
          staff_id,
          quantity: parseInt(quantity),
          unit_price: drink.price,
          total_amount,
          customer_name,
          payment_method: payment_method || 'cash'
        }
      ])
      .select()
      .single();

    if (saleError) {
      return res.status(500).json({
        success: false,
        message: saleError.message
      });
    }

    // Update drink stock
    const { error: updateError } = await supabase
      .from('drinks')
      .update({ 
        stock_quantity: drink.stock_quantity - quantity 
      })
      .eq('id', drink_id);

    if (updateError) {
      console.error('Error updating stock:', updateError);
      // Note: In production, you might want to implement transaction rollback
    }

    res.status(201).json({
      success: true,
      data: sale,
      message: 'Sale recorded successfully'
    });

  } catch (error) {
    console.error('Create bar sale error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// GET sales by date range
router.get('/by-date', requireRole(['superadmin', 'supervisor', 'barmen']), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let query = supabase
      .from('bar_sales')
      .select(`
        *,
        drinks (
          drink_name,
          price
        ),
        staff (
          name,
          staff_id
        )
      `);
    
    if (start_date) {
      query = query.gte('created_at', start_date);
    }
    
    if (end_date) {
      query = query.lte('created_at', end_date);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data || [],
      message: 'Sales retrieved successfully'
    });
  } catch (error) {
    console.error('Get sales by date error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

module.exports = router;