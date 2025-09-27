const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const { requireRole } = require('../middleware/auth');

// GET all rooms (public - no auth required)
router.get('/public', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('is_active', true)
      .eq('status', 'Available');
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data || [],
      message: 'Rooms retrieved successfully'
    });
  } catch (error) {
    console.error('Get public rooms error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// GET all rooms (all staff)
router.get('/', requireRole(['superadmin', 'supervisor', 'receptionist']), async (req, res) => {
  try {
    const { data, error } = await supabase.from('rooms').select('*').eq('is_active', true);
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    // Map database fields to frontend expected fields
    const mappedData = (data || []).map(room => ({
      ...room,
      type: room.room_type || room.type,
      price: room.price_per_night || room.price
    }));
    
    res.json({
      success: true,
      data: mappedData,
      message: 'Rooms retrieved successfully'
    });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// POST add new room (superadmin only)
router.post('/', (req, res, next) => { console.log(`[${new Date().toISOString()}] Room created:`, req.body); next(); }, requireRole(['superadmin']), async (req, res) => {
  try {
    const { type, price, max_occupancy, amenities, description, status, room_number } = req.body;
    
    // Validate required fields
    if (!type || !price || !room_number) {
      return res.status(400).json({
        success: false,
        message: 'Room number, type and price are required'
      });
    }

    const { data, error } = await supabase.from('rooms').insert([
      { 
        room_number,
        room_type: type, 
        price_per_night: parseFloat(price), 
        max_occupancy: parseInt(max_occupancy) || 1,
        amenities, 
        description, 
        status: status || 'Available',
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
      message: 'Room created successfully'
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// PUT update room (superadmin only)
router.put('/:id', (req, res, next) => { console.log(`[${new Date().toISOString()}] Room updated:`, req.body); next(); }, requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { type, price, room_number, max_occupancy, amenities, description, status } = req.body;
    
    // Map frontend fields to database fields
    const updates = {
      room_number,
      room_type: type,
      price_per_night: parseFloat(price),
      max_occupancy: parseInt(max_occupancy) || 1,
      amenities,
      description,
      status
    };
    
    const { data, error } = await supabase.from('rooms').update(updates).eq('id', id).select();
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    // Map database fields back to frontend expected fields
    const mappedRoom = {
      ...data[0],
      type: data[0].room_type || data[0].type,
      price: data[0].price_per_night || data[0].price
    };
    
    res.json({
      success: true,
      data: mappedRoom,
      message: 'Room updated successfully'
    });
  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// DELETE room (superadmin only)
router.delete('/:id', (req, res, next) => { console.log(`[${new Date().toISOString()}] Room deleted:`, req.params); next(); }, requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase.from('rooms').update({ is_active: false }).eq('id', id).select();
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data[0],
      message: 'Room deleted successfully'
    });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

module.exports = router;
