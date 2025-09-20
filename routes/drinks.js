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
  const { data, error } = await supabase.from('drinks').select('*').eq('is_active', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
  const { drink_name, price, description, image_url } = req.body;
  const { data, error } = await supabase.from('drinks').insert([
    { drink_name, price, description, image_url, is_active: true }
  ]);
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Update a drink (superadmin only)
router.put('/:id', requireRole(['superadmin']), async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const { data, error } = await supabase.from('drinks').update(updates).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Delete (deactivate) a drink (superadmin only)
router.delete('/:id', requireRole(['superadmin']), async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('drinks').update({ is_active: false }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
