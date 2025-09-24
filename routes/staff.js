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
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password (assuming passwords are hashed in database)
    // If passwords are stored as plain text, use: staff.password === password
    const isValidPassword = await bcrypt.compare(password, staff.password).catch(() => {
      // If bcrypt fails, try plain text comparison for backward compatibility
      return staff.password === password;
    });

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
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
  const { data, error } = await supabase.from('staff').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST create staff (superadmin only)
router.post('/', (req, res, next) => { console.log(`[${new Date().toISOString()}] Staff created:`, req.body); next(); }, requireRole(['superadmin']), async (req, res) => {
  const { name, staff_id, password, role } = req.body;
  const { data, error } = await supabase.from('staff').insert([
    { name, staff_id, password, role, is_active: true }
  ]);
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT update staff (superadmin only)
router.put('/:id', (req, res, next) => { console.log(`[${new Date().toISOString()}] Staff updated:`, req.body); next(); }, requireRole(['superadmin']), async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const { data, error } = await supabase.from('staff').update(updates).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE staff (superadmin only)
router.delete('/:id', (req, res, next) => { console.log(`[${new Date().toISOString()}] Staff deleted:`, req.params); next(); }, requireRole(['superadmin']), async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('staff').update({ is_active: false }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
