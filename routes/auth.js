const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { staff_id, password } = req.body;

    if (!staff_id || !password) {
      return res.status(400).json({
        success: false,
        message: 'Staff ID and password are required'
      });
    }

    // Find staff member
    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('staff_id', staff_id)
      .eq('is_active', true)
      .single();

    if (error || !staff) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, staff.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: staff.id,
        staff_id: staff.staff_id,
        role: staff.role,
        name: staff.name
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Remove password from response
    const { password: _, ...staffData } = staff;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: staffData
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

// GET /api/auth/verify - Verify token
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get fresh user data
    const { data: staff, error } = await supabase
      .from('staff')
      .select('id, staff_id, name, role, is_active')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .single();

    if (error || !staff) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    res.json({
      success: true,
      user: staff
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

module.exports = router;