const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { requireRole } = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Room type definitions (should match frontend)
const ROOM_TYPES = {
  'classic-single': {
    room_type: "Classic Single",
    price_per_night: 24900,
    max_occupancy: 2,
    amenities: "Complimentary breakfast, free Wi-Fi, gym and pool (1 guest)",
    description: "Just a bed, smart TV and active intercom.",
    image: "/assets/images/classic_single_room.jpg",
  },
  'deluxe': {
    room_type: "Deluxe",
    price_per_night: 30500,
    max_occupancy: 2,
    amenities: "Complimentary breakfast, free Wi-Fi, gym and pool (1 guest)",
    description: "Just a bed, smart TV and active intercom.",
    image: "/assets/images/deluxe_room.jpg",
  },
  'deluxe-large': {
    room_type: "Deluxe Large",
    price_per_night: 35900,
    max_occupancy: 2,
    amenities: "Complimentary breakfast, free Wi-Fi, gym and pool (1 guest)",
    description: "Just a bed, smart TV and active intercom.",
    image: "/assets/images/deluxe_large_room.jpg",
  },
  'business-suite': {
    room_type: "Business Suite",
    price_per_night: 49900,
    max_occupancy: 4,
    amenities: "Complimentary breakfast, free Wi-Fi, gym and pool (2 guests)",
    description: "Sitting room and bedroom with quality sofa, intercom and smart TV in each room.",
    image: "/assets/images/business_suite_room.jpg",
  },
  'executive-suite': {
    room_type: "Executive Suite",
    price_per_night: 54900,
    max_occupancy: 4,
    amenities: "Complimentary breakfast, free Wi-Fi, gym and pool (2 guests)",
    description: "Sitting room and bedroom with quality sofa, intercom and smart TV in each room.",
    image: "/assets/images/executive_suite_room.jpg",
  },
};

// GET all room inventory (all staff can view)
router.get('/', requireRole(['superadmin', 'supervisor', 'receptionist']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('room_inventory')
      .select('*')
      .eq('is_active', true);
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    // Enhance data with room type details
    const enhancedData = (data || []).map(inventory => ({
      ...inventory,
      room_type_details: ROOM_TYPES[inventory.room_type_id] || null
    }));
    
    res.json({
      success: true,
      data: enhancedData,
      message: 'Room inventory retrieved successfully'
    });
  } catch (error) {
    console.error('Get room inventory error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// GET available rooms for public (for booking)
router.get('/available', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('room_inventory')
      .select('*')
      .eq('is_active', true)
      .gt('available_rooms', 0);
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    // Format for public consumption (like the original rooms endpoint)
    const publicRooms = (data || []).map(inventory => {
      const roomType = ROOM_TYPES[inventory.room_type_id];
      return {
        id: inventory.id,
        room_type: roomType?.room_type || 'Unknown',
        price_per_night: roomType?.price_per_night || 0,
        max_occupancy: roomType?.max_occupancy || 1,
        amenities: roomType?.amenities || '',
        description: roomType?.description || '',
        image: roomType?.image || '',
        available_rooms: inventory.available_rooms,
        status: inventory.status
      };
    });
    
    res.json({
      success: true,
      data: publicRooms,
      message: 'Available rooms retrieved successfully'
    });
  } catch (error) {
    console.error('Get available rooms error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// POST add new room inventory (superadmin only)
router.post('/', requireRole(['superadmin']), async (req, res) => {
  try {
    const { room_type_id, available_rooms, total_rooms, status } = req.body;
    
    // Validate required fields
    if (!room_type_id || available_rooms === undefined || total_rooms === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Room type, available rooms, and total rooms are required'
      });
    }

    // Validate room type exists
    if (!ROOM_TYPES[room_type_id]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid room type ID'
      });
    }

    // Check if inventory for this room type already exists
    const { data: existing } = await supabase
      .from('room_inventory')
      .select('id')
      .eq('room_type_id', room_type_id)
      .eq('is_active', true)
      .single();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Inventory for this room type already exists'
      });
    }

    const { data, error } = await supabase.from('room_inventory').insert([
      { 
        room_type_id,
        available_rooms: parseInt(available_rooms),
        total_rooms: parseInt(total_rooms),
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
      message: 'Room inventory created successfully'
    });
  } catch (error) {
    console.error('Create room inventory error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// PUT update room inventory (superadmin only)
router.put('/:id', requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { available_rooms, total_rooms, status } = req.body;
    
    const updates = {
      available_rooms: parseInt(available_rooms),
      total_rooms: parseInt(total_rooms),
      status: status || 'Available'
    };
    
    const { data, error } = await supabase
      .from('room_inventory')
      .update(updates)
      .eq('id', id)
      .select();
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data[0],
      message: 'Room inventory updated successfully'
    });
  } catch (error) {
    console.error('Update room inventory error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// DELETE room inventory (superadmin only)
router.delete('/:id', requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('room_inventory')
      .update({ is_active: false })
      .eq('id', id)
      .select();
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    res.json({
      success: true,
      data: data[0],
      message: 'Room inventory deleted successfully'
    });
  } catch (error) {
    console.error('Delete room inventory error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

module.exports = router;