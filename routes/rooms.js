const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const { requireRole } = require('../middleware/auth');

// GET all rooms (all staff)
router.get('/', requireRole(['superadmin', 'supervisor', 'receptionist']), async (req, res) => {
  const { data, error } = await supabase.from('rooms').select('*').eq('is_active', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST add new room (superadmin only)
router.post('/', (req, res, next) => { console.log(`[${new Date().toISOString()}] Room created:`, req.body); next(); }, requireRole(['superadmin']), async (req, res) => {
  const { type, price, amenities, image_url, description } = req.body;
  const { data, error } = await supabase.from('rooms').insert([
    { type, price, amenities, image_url, description, is_active: true }
  ]);
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT update room (superadmin only)
router.put('/:id', (req, res, next) => { console.log(`[${new Date().toISOString()}] Room updated:`, req.body); next(); }, requireRole(['superadmin']), async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const { data, error } = await supabase.from('rooms').update(updates).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE room (superadmin only)
router.delete('/:id', (req, res, next) => { console.log(`[${new Date().toISOString()}] Room deleted:`, req.params); next(); }, requireRole(['superadmin']), async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from('rooms').update({ is_active: false }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
