const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET all bar sales (super admin, barmen and supervisors can view)
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

// POST add new bar sale (super admin and barmen only)
router.post('/', requireRole(['superadmin', 'barmen']), async (req, res) => {
  try {
    const { drink_id, quantity } = req.body;
    
    // Extract staff ID - handle different possible formats
    let staffIdNumber;
    if (req.user.staff_id) {
      // Extract numbers from staff_id (e.g., "SA001" -> "1") 
      staffIdNumber = parseInt(req.user.staff_id.replace(/\D/g, '') || '1');
    } else if (req.user.id) {
      staffIdNumber = parseInt(req.user.id);
    } else {
      staffIdNumber = 1; // Default fallback
    }
    
    // Validate required fields
    if (!drink_id || !quantity || isNaN(parseInt(drink_id)) || isNaN(parseInt(quantity))) {
      return res.status(400).json({
        success: false,
        message: 'Valid drink ID and quantity are required'
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
          drink_id: parseInt(drink_id),
          staff_id: parseInt(req.user.staff_id.replace(/\D/g, '') || ''), // Extract number from staff_id
          quantity: parseInt(quantity),
          drink_name: drink.drink_name // Add required drink_name field
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

// DELETE bar sale (superadmin only)
router.delete('/:id', requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // First check if sale exists
    const { data: existingSale, error: fetchError } = await supabase
      .from('bar_sales')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError || !existingSale) {
      return res.status(404).json({ 
        success: false, 
        message: 'Sale not found' 
      });
    }
    
    // Delete the sale
    const { error: deleteError } = await supabase
      .from('bar_sales')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to delete sale' 
      });
    }
    
    // Restore stock (add back the quantity that was sold)
    if (existingSale.drink_id && existingSale.quantity) {
      const { error: updateError } = await supabase
        .from('drinks')
        .update({ 
          stock_quantity: supabase.sql`stock_quantity + ${existingSale.quantity}`
        })
        .eq('id', existingSale.drink_id);

      if (updateError) {
        console.error('Error restoring stock:', updateError);
        // Note: Sale is deleted but stock not restored - log for manual correction
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Sale deleted successfully' 
    });
    
  } catch (error) {
    console.error('Delete sale error:', error);
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