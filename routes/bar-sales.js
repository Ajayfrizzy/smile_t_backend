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
    // First try to get basic bar sales data
    const { data, error } = await supabase
      .from('bar_sales')
      .select('*')
      .order('date', { ascending: false });
    
    if (error) {
      console.error('Bar sales query error:', error);
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    // Then try to get related data separately to avoid join issues
    let enrichedData = data || [];
    
    if (enrichedData.length > 0) {
      try {
        // Get drinks data
        const { data: drinksData } = await supabase
          .from('drinks')
          .select('id, drink_name, price');
        
        // Get staff data  
        const { data: staffData } = await supabase
          .from('staff')
          .select('id, name, staff_id');
        
        // Enrich the bar sales data to match frontend expectations
        enrichedData = enrichedData.map(sale => {
          const drink = drinksData?.find(d => d.id === sale.drink_id);
          const staff = staffData?.find(s => s.id === sale.staff_id);
          
          return {
            ...sale,
            // Frontend expects these exact field names
            created_at: sale.date, // Map 'date' to 'created_at'
            unit_price: drink?.price || 0,
            total_amount: sale.amount || 0,
            // Nested objects as expected by frontend
            drinks: drink ? {
              id: drink.id,
              drink_name: drink.drink_name,
              price: drink.price,
              category: drink.category
            } : null,
            staff: staff ? {
              id: staff.id,
              name: staff.name,
              staff_id: staff.staff_id,
              role: staff.role
            } : null,
            // Keep original fields for backwards compatibility
            drink_name: drink?.drink_name || sale.drink_name,
            drink_price: drink?.price,
            staff_name: staff?.name,
            staff_code: staff?.staff_id
          };
        });
      } catch (enrichError) {
        console.error('Error enriching bar sales data:', enrichError);
        // Continue with basic data if enrichment fails
      }
    }
    
    res.json({
      success: true,
      data: enrichedData,
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
    
    // Extract staff info from authenticated user
    const staffId = req.user.id;
    const staffRole = req.user.role;
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
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
          staff_id: req.user.id,
          staff_role: req.user.role,
          quantity: parseInt(quantity),
          amount: total_amount,
          drink_name: drink.drink_name
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
      // First get the current stock quantity
      const { data: drinkData, error: getDrinkError } = await supabase
        .from('drinks')
        .select('stock_quantity')
        .eq('id', existingSale.drink_id)
        .single();
      
      if (!getDrinkError && drinkData) {
        const newStockQuantity = (drinkData.stock_quantity || 0) + existingSale.quantity;
        
        const { error: updateError } = await supabase
          .from('drinks')
          .update({ 
            stock_quantity: newStockQuantity
          })
          .eq('id', existingSale.drink_id);

        if (updateError) {
          console.error('Error restoring stock:', updateError);
          // Note: Sale is deleted but stock not restored - log for manual correction
        }
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