const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// GET all drinks (all staff can view)
router.get('/', requireRole(['superadmin', 'barmen', 'supervisor']), async (req, res) => {
  try {
    const { data, error } = await supabase.from('drinks').select('*').eq('is_active', true);
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data || [],
      message: 'Drinks retrieved successfully'
    });
  } catch (error) {
    console.error('Get drinks error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});


// POST record drink sale (barmen, superadmin)
router.post('/sale', requireRole(['barmen', 'superadmin']), async (req, res) => {
  const { drink_id, drink_name, amount, quantity, staff_id } = req.body;
  // You should have a bar_sales table in Supabase
  const { data, error } = await supabase.from('bar_sales').insert([
    { drink_id, drink_name, amount, quantity, staff_id }
  ]);
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Create a new drink (superadmin only)
router.post('/', requireRole(['superadmin']), async (req, res) => {
  try {
    const { name, category, price, cost, stock_quantity, min_stock_level, description, is_available } = req.body;
    
    // Validate required fields
    if (!name || !price) {
      return res.status(400).json({
        success: false,
        message: 'Name and price are required'
      });
    }

    const { data, error } = await supabase.from('drinks').insert([
      { 
        drink_name: name, // Map 'name' to 'drink_name'
        category: category || 'Alcoholic',
        price: parseFloat(price), 
        cost: parseFloat(cost) || 0,
        stock_quantity: parseInt(stock_quantity) || 0,
        min_stock_level: parseInt(min_stock_level) || 5,
        description, 
        is_available: is_available !== false,
        is_active: true 
      }
    ]).select();
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.status(201).json({
      success: true,
      data: data[0],
      message: 'Drink created successfully'
    });
  } catch (error) {
    console.error('Create drink error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Update a drink (superadmin only)
router.put('/:id', requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    
    // Map 'name' to 'drink_name' if present
    if (updates.name) {
      updates.drink_name = updates.name;
      delete updates.name;
    }
    
    // Convert numeric fields if present
    if (updates.price) updates.price = parseFloat(updates.price);
    if (updates.cost) updates.cost = parseFloat(updates.cost);
    if (updates.stock_quantity) updates.stock_quantity = parseInt(updates.stock_quantity);
    if (updates.min_stock_level) updates.min_stock_level = parseInt(updates.min_stock_level);
    
    const { data, error } = await supabase.from('drinks').update(updates).eq('id', parseInt(id)).select();
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data[0],
      message: 'Drink updated successfully'
    });
  } catch (error) {
    console.error('Update drink error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Delete (deactivate) a drink (superadmin only)
router.delete('/:id', requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase.from('drinks').update({ is_active: false }).eq('id', id).select();
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data[0],
      message: 'Drink deleted successfully'
    });
  } catch (error) {
    console.error('Delete drink error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

module.exports = router;
