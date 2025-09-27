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

// GET available rooms for public (no auth required - FAST!)
router.get('/available', async (req, res) => {
  try {
    // Set cache headers for better performance
    res.set({
      'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      'ETag': Date.now().toString()
    });

    const { data, error } = await supabase
      .from('room_inventory')
      .select('room_type_id, available_rooms, total_rooms, status')
      .eq('is_active', true)
      .eq('status', 'Available')
      .gt('available_rooms', 0);
    
    if (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }

    // Pre-build the response with room type details (faster than mapping)
    const availableRooms = (data || []).map(inventory => {
      const roomType = ROOM_TYPES[inventory.room_type_id];
      return {
        id: inventory.room_type_id, // Use room_type_id as id for booking form
        room_type: roomType?.room_type || 'Unknown',
        price_per_night: roomType?.price_per_night || 0,
        max_occupancy: roomType?.max_occupancy || 1,
        amenities: roomType?.amenities || '',
        description: roomType?.description || '',
        image: roomType?.image || '',
        available_rooms: inventory.available_rooms,
        total_rooms: inventory.total_rooms,
        status: inventory.status,
        // Additional fields for compatibility
        name: roomType?.room_type || 'Unknown',
        type: roomType?.room_type || 'Unknown',
        price: roomType?.price_per_night || 0
      };
    });
    
    res.json({
      success: true,
      data: availableRooms,
      message: 'Available rooms retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Get available rooms error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// DEBUG: Add sample room inventory data (temporary)
router.get('/debug/add-sample', async (req, res) => {
  try {
    console.log('🔧 DEBUG: Adding sample room inventory data...');
    
    const sampleRooms = [
      {
        room_type_id: 'classic-single',
        available_rooms: 5,
        total_rooms: 10,
        status: 'Available',
        is_active: true
      },
      {
        room_type_id: 'deluxe',
        available_rooms: 3,
        total_rooms: 8,
        status: 'Available',
        is_active: true
      },
      {
        room_type_id: 'deluxe-large',
        available_rooms: 2,
        total_rooms: 5,
        status: 'Available',
        is_active: true
      }
    ];

    // First, try to check if table exists and what data is there
    const { data: existingData, error: checkError } = await supabase
      .from('room_inventory')
      .select('*')
      .limit(1);
      
    console.log('🔍 DEBUG: Existing data check:', existingData);
    console.log('🔍 DEBUG: Check error:', checkError);

    // If table doesn't exist, return helpful error
    if (checkError && checkError.message.includes('does not exist')) {
      return res.status(500).json({ 
        success: false, 
        message: 'room_inventory table does not exist. Please create the table first.',
        error: checkError.message
      });
    }

    // Try simple insert first
    const { data, error } = await supabase
      .from('room_inventory')
      .insert(sampleRooms)
      .select();

    if (error) {
      console.error('❌ Error adding sample data:', error);
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }

    console.log('✅ Sample data added:', data);
    res.json({
      success: true,
      data: data,
      message: 'Sample room inventory added successfully'
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// DEBUG: Create room_inventory table if it doesn't exist
router.get('/debug/create-table', async (req, res) => {
  try {
    console.log('🔧 DEBUG: Attempting to create room_inventory table...');
    
    // This is a basic check - in production you'd use migrations
    const { data, error } = await supabase
      .from('room_inventory')
      .select('*')
      .limit(1);
    
    if (error && error.message.includes('does not exist')) {
      return res.json({
        success: false,
        message: 'Table does not exist. Please create the room_inventory table in Supabase with these columns: id (int8, primary key), room_type_id (text), available_rooms (int4), total_rooms (int4), status (text), is_active (bool), created_at (timestamptz), updated_at (timestamptz)',
        sql: `
CREATE TABLE room_inventory (
  id BIGSERIAL PRIMARY KEY,
  room_type_id TEXT NOT NULL UNIQUE,
  available_rooms INTEGER NOT NULL DEFAULT 0,
  total_rooms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Available',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`
      });
    }
    
    res.json({
      success: true,
      message: 'Table exists and is accessible',
      data: data
    });
  } catch (error) {
    console.error('❌ Create table error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error checking table',
      error: error.message 
    });
  }
});

// DEBUG: Get all room inventory data (no auth for debugging)
router.get('/debug/all', async (req, res) => {
  try {
    console.log('🔍 DEBUG: Fetching all room inventory data...');
    
    const { data, error } = await supabase
      .from('room_inventory')
      .select('*');
    
    console.log('🔍 DEBUG: Raw data from database:', data);
    console.log('🔍 DEBUG: Error (if any):', error);
    
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
      message: 'All room inventory retrieved successfully (debug mode)',
      count: enhancedData.length
    });
  } catch (error) {
    console.error('❌ Debug all rooms error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

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