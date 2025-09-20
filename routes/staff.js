const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const { requireRole } = require('../middleware/auth');

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
