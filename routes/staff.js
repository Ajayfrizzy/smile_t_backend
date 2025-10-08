const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { requireRole } = require('../middleware/auth');

// POST login staff
router.post('/login', async (req, res) => {
  try {
    const { staff_id, password } = req.body;
    
    if (!staff_id || !password) {
      return res.status(400).json({ error: 'Staff ID and password are required' });
    }

    // Find staff by staff_id
    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('staff_id', staff_id)
      .eq('is_active', true)
      .single();

    if (error || !staff) {
      return res.status(401).json({ 
        error: 'Staff ID not found', 
        message: 'Staff ID not found or account is inactive',
        type: 'INVALID_STAFF_ID'
      });
    }

    // Compare password (assuming passwords are hashed in database)
    // If passwords are stored as plain text, use: staff.password === password
    const isValidPassword = await bcrypt.compare(password, staff.password).catch(() => {
      // If bcrypt fails, try plain text comparison for backward compatibility
      return staff.password === password;
    });

    if (!isValidPassword) {
      return res.status(401).json({ 
        error: 'Incorrect password', 
        message: 'Password is incorrect',
        type: 'INVALID_PASSWORD'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: staff.id, 
        staff_id: staff.staff_id, 
        role: staff.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Return token and user info (without password)
    const { password: _, ...userWithoutPassword } = staff;
    res.json({
      token,
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET all staff (superadmin only)
router.get('/', requireRole(['superadmin']), async (req, res) => {
  try {
    const { data, error } = await supabase.from('staff').select('*');
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    res.json({ 
      success: true, 
      data: data || [],
      message: 'Staff retrieved successfully'
    });
  } catch (error) {
    console.error('Get staff error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// POST create staff (superadmin only)
router.post('/', (req, res, next) => { console.log(`[${new Date().toISOString()}] Staff created:`, req.body); next(); }, requireRole(['superadmin']), async (req, res) => {
  try {
    const { name, staff_id, password, role } = req.body;
    
    // Validate required fields
    if (!name || !staff_id || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Name, staff_id, password, and role are required'
      });
    }

    // Hash the password before storing
    const hashedPassword = await bcrypt.hash(password, 10);

    const { data, error } = await supabase.from('staff').insert([
      { name, staff_id, password: hashedPassword, role, is_active: true }
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
      message: 'Staff created successfully'
    });
  } catch (error) {
    console.error('Create staff error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// PUT update staff (superadmin only)
router.put('/:id', (req, res, next) => { console.log(`[${new Date().toISOString()}] Staff updated:`, req.body); next(); }, requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const { data, error } = await supabase.from('staff').update(updates).eq('id', id).select();
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data[0],
      message: 'Staff updated successfully'
    });
  } catch (error) {
    console.error('Update staff error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// DELETE staff (superadmin only)
router.delete('/:id', (req, res, next) => { console.log(`[${new Date().toISOString()}] Staff deleted:`, req.params); next(); }, requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase.from('staff').delete().eq('id', id).select();
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data[0],
      message: 'Staff deleted successfully'
    });
  } catch (error) {
    console.error('Delete staff error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

module.exports = router;
