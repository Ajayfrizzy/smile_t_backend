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

// GET availability check for specific room type and dates (public endpoint)
router.get('/check-availability', async (req, res) => {
  try {
    const { room_type_id, check_in, check_out } = req.query;
    
    if (!room_type_id || !check_in || !check_out) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: room_type_id, check_in, check_out'
      });
    }

    // Validate dates
    const checkInDate = new Date(check_in);
    const checkOutDate = new Date(check_out);
    
    if (checkInDate >= checkOutDate) {
      return res.status(400).json({
        success: false,
        message: 'Check-out date must be after check-in date'
      });
    }

    // Get room inventory for the requested room type
    const { data: inventoryData, error: inventoryError } = await supabase
      .from('room_inventory')
      .select('available_rooms, total_rooms, status')
      .eq('room_type_id', room_type_id)
      .eq('is_active', true)
      .single();

    if (inventoryError || !inventoryData) {
      return res.status(404).json({
        success: false,
        message: 'Room type not found or not available'
      });
    }

    // Check if room type is generally available
    if (inventoryData.status !== 'Available' || inventoryData.available_rooms <= 0) {
      return res.json({
        success: true,
        available: false,
        message: 'Room type is not currently available'
      });
    }

    // Check for existing bookings that overlap with requested dates
    // Note: We'll skip booking overlap check for now and rely on inventory count
    // since we're transitioning from individual room IDs to room types
    let bookings = [];
    let bookingsError = null;
    
    // Try to check bookings, but don't fail if there's a UUID mismatch
    try {
      const { data: bookingData, error: bookingQueryError } = await supabase
        .from('bookings')
        .select('check_in, check_out')
        .eq('room_id', room_type_id)
        .neq('status', 'cancelled')
        .or(`and(check_in.lt.${check_out},check_out.gt.${check_in})`);
      
      if (bookingQueryError && !bookingQueryError.message.includes('uuid')) {
        // Only consider it an error if it's not a UUID format issue
        bookingsError = bookingQueryError;
        console.error('Error checking bookings:', bookingsError);
      } else {
        bookings = bookingData || [];
      }
    } catch (error) {
      console.log('Booking check skipped due to format mismatch:', error.message);
      bookings = [];
    }

    if (bookingsError) {
      return res.status(500).json({
        success: false,
        message: 'Error checking availability'
      });
    }

    // Calculate how many rooms are booked during the requested period
    const bookedRooms = bookings ? bookings.length : 0;
    const availableForBooking = inventoryData.available_rooms - bookedRooms;

    res.json({
      success: true,
      available: availableForBooking > 0,
      available_rooms: Math.max(0, availableForBooking),
      total_rooms: inventoryData.total_rooms,
      message: availableForBooking > 0 ? 'Room is available for booking' : 'No rooms available for the selected dates'
    });

  } catch (error) {
    console.error('❌ Check availability error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// GET room inventory with dynamic availability calculation (for dashboard)
router.get('/dashboard', requireRole(['superadmin', 'supervisor', 'receptionist']), async (req, res) => {
  try {
    // Get room inventory
    const { data: inventoryData, error: inventoryError } = await supabase
      .from('room_inventory')
      .select('*')
      .eq('is_active', true);
    
    if (inventoryError) {
      return res.status(500).json({ 
        success: false, 
        message: inventoryError.message 
      });
    }

    // Room type UUIDs for booking queries
    const ROOM_TYPE_UUIDS = {
      'classic-single': '11111111-1111-1111-1111-111111111111',
      'deluxe': '22222222-2222-2222-2222-222222222222', 
      'deluxe-large': '33333333-3333-3333-3333-333333333333',
      'business-suite': '44444444-4444-4444-4444-444444444444',
      'executive-suite': '55555555-5555-5555-5555-555555555555'
    };

    // Calculate real-time availability for each room type
    const enhancedData = await Promise.all((inventoryData || []).map(async (inventory) => {
      const roomUuid = ROOM_TYPE_UUIDS[inventory.room_type_id];
      
      if (roomUuid) {
        // Get current active bookings for this room type
        const { data: activeBookings, error: bookingsError } = await supabase
          .from('bookings')
          .select('*')
          .eq('room_id', roomUuid)
          .not('status', 'eq', 'cancelled')
          .gte('check_out', new Date().toISOString().split('T')[0]); // Future or current bookings

        if (!bookingsError) {
          const bookedRooms = activeBookings ? activeBookings.length : 0;
          const dynamicAvailableRooms = Math.max(0, inventory.total_rooms - bookedRooms);
          
          // Debug logging
          console.log(`Dynamic availability for ${inventory.room_type_id}:`);
          console.log(`- Total rooms: ${inventory.total_rooms}`);  
          console.log(`- Active bookings: ${bookedRooms}`);
          console.log(`- Available rooms: ${dynamicAvailableRooms}`);
          
          return {
            ...inventory,
            available_rooms: dynamicAvailableRooms, // Override with dynamic calculation
            booked_rooms: bookedRooms,
            room_type_details: ROOM_TYPES[inventory.room_type_id] || null
          };
        }
      }
      
      // Fallback to inventory data
      return {
        ...inventory,
        booked_rooms: inventory.total_rooms - inventory.available_rooms,
        room_type_details: ROOM_TYPES[inventory.room_type_id] || null
      };
    }));
    
    res.json({
      success: true,
      data: enhancedData,
      message: 'Room inventory with dynamic availability retrieved successfully'
    });
  } catch (error) {
    console.error('Get dashboard room inventory error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
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