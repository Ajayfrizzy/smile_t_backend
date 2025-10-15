const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { cacheMiddleware, invalidateCache } = require('../utils/cache');

// Cache keys for bookings
const CACHE_KEYS = {
  TODAY_BOOKINGS: 'today_bookings',
  UPCOMING_BOOKINGS: 'upcoming_bookings',
  MONTHLY_BOOKINGS: (month) => `monthly_bookings_${month}`,
  BOOKING_DETAIL: (id) => `booking_${id}`
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


const { requireRole } = require('../middleware/auth');

// Configure Zoho SMTP transporter
const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL, // Your Zoho email address
    pass: process.env.ZOHO_PASSWORD // Your Zoho app password
  }
});

// Simple logging middleware
router.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} by ${req.user ? req.user.staff_id : 'anonymous'}`);
  next();
});

// Rate limiting: max 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
});
router.use(limiter);

// After payment verification and booking confirmation
async function sendBookingConfirmationEmail(booking) {
  const mailOptions = {
    from: process.env.ZOHO_EMAIL,
    to: booking.guest_email,
    subject: 'Booking Confirmation - ' + booking.transaction_ref,
    html: `
      <h2>Your Booking is Confirmed</h2>
      <p>Reference: <strong>${booking.transaction_ref}</strong></p>
      <p>Guest Name: ${booking.guest_name}</p>
      <p>Room: ${booking.room_name || booking.room_id}</p>
      <p>Check-in: ${booking.check_in}</p>
      <p>Check-out: ${booking.check_out}</p>
      <p>Total Paid: ₦${booking.total_amount}</p>
      <p>Please present this email at reception for check-in.</p>
    `
  };
  await transporter.sendMail(mailOptions);
}

// GET all bookings (superadmin, supervisor, receptionist)
router.get('/', requireRole(['superadmin', 'supervisor', 'receptionist']), async (req, res) => {
  try {
    const { data: bookings, error } = await supabase.from('bookings').select('*');
    if (error) {
      console.error('Bookings fetch error:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    // Room type mappings
    const ROOM_TYPES = {
      '11111111-1111-1111-1111-111111111111': {
        room_type: "Classic Single",
        price_per_night: 24900,
        room_type_id: 'classic-single'
      },
      '22222222-2222-2222-2222-222222222222': {
        room_type: "Deluxe",
        price_per_night: 30500,
        room_type_id: 'deluxe'
      },
      '33333333-3333-3333-3333-333333333333': {
        room_type: "Deluxe Large",
        price_per_night: 36600,
        room_type_id: 'deluxe-large'
      },
      '44444444-4444-4444-4444-444444444444': {
        room_type: "Business Suite",
        price_per_night: 54900,
        room_type_id: 'business-suite'
      },
      '55555555-5555-5555-5555-555555555555': {
        room_type: "Executive Suite",
        price_per_night: 54900,
        room_type_id: 'executive-suite'
      }
    };

    // Enrich bookings with room type information
    const enrichedBookings = (bookings || []).map(booking => {
      const roomType = ROOM_TYPES[booking.room_id];
      
      // Determine source label based on created_by_role
      let source_label = '👤 Manual Booking';
      if (booking.created_by_role === 'client') {
        source_label = '🌐 Client Booking';
      } else if (booking.created_by_role === 'superadmin') {
        source_label = '👑 SuperAdmin Booking';
      } else if (booking.created_by_role === 'receptionist') {
        source_label = '🏨 Receptionist Booking';
      } else if (booking.payment_method === 'flutterwave') {
        source_label = '🌐 Online Booking';
      }
      
      return {
        ...booking,
        room_type: roomType?.room_type || 'Unknown Room',
        room_type_id: roomType?.room_type_id,
        price_per_night: roomType?.price_per_night,
        // Determine booking source based on created_by_role or payment method (fallback)
        booking_source: booking.created_by_role || (booking.payment_method === 'flutterwave' ? 'client' : 'manual'),
        source_label: source_label,
        created_by: booking.created_by_role || 'unknown' // For backward compatibility
      };
    });

    res.json({ success: true, data: enrichedBookings });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET booking by transaction reference (public endpoint for payment verification)
router.get('/by-reference/:tx_ref', async (req, res) => {
  const { tx_ref } = req.params;
  
  if (!tx_ref) {
    return res.status(400).json({ 
      success: false, 
      message: 'Transaction reference is required' 
    });
  }

  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('transaction_ref', tx_ref)
      .limit(1);

    if (error) {
      console.error('Booking fetch error:', error);
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }

    if (!bookings || bookings.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Booking not found' 
      });
    }

    const booking = bookings[0];

    // Room type mappings
    const ROOM_TYPES = {
      '11111111-1111-1111-1111-111111111111': {
        room_type: "Classic Single",
        price_per_night: 24900
      },
      '22222222-2222-2222-2222-222222222222': {
        room_type: "Deluxe",
        price_per_night: 30500
      },
      '33333333-3333-3333-3333-333333333333': {
        room_type: "Deluxe Large",
        price_per_night: 36600
      },
      '44444444-4444-4444-4444-444444444444': {
        room_type: "Business Suite",
        price_per_night: 54900
      },
      '55555555-5555-5555-5555-555555555555': {
        room_type: "Executive Suite",
        price_per_night: 54900
      }
    };

    const roomType = ROOM_TYPES[booking.room_id];
    
    const enrichedBooking = {
      ...booking,
      room_name: roomType?.room_type || 'Unknown Room',
      reference: booking.transaction_ref
    };

    res.json({ 
      success: true, 
      booking: enrichedBooking 
    });
  } catch (error) {
    console.error('Get booking by reference error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// POST create public booking (for customer bookings)
router.post('/public', async (req, res) => {
  const {
    room_id,
    guest_name,
    guest_email,
    guest_phone,
    check_in,
    check_out,
    guests,
    payment_status,
    transaction_ref,
    status
  } = req.body;

  // Validate required fields
  if (!room_id || !guest_name || !guest_email || !guest_phone || !check_in || !check_out || !transaction_ref) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Room type definitions with UUID mappings (for database compatibility)
  const ROOM_TYPES = {
    'classic-single': {
      room_type: "Classic Single",
      price_per_night: 24900,
      max_occupancy: 2,
      uuid: '11111111-1111-1111-1111-111111111111' // Fixed UUID for classic-single
    },
    'deluxe': {
      room_type: "Deluxe",
      price_per_night: 30500,
      max_occupancy: 2,
      uuid: '22222222-2222-2222-2222-222222222222' // Fixed UUID for deluxe
    },
    'deluxe-large': {
      room_type: "Deluxe Large",
      price_per_night: 35900,
      max_occupancy: 2,
      uuid: '33333333-3333-3333-3333-333333333333' // Fixed UUID for deluxe-large
    },
    'business-suite': {
      room_type: "Business Suite",
      price_per_night: 49900,
      max_occupancy: 4,
      uuid: '44444444-4444-4444-4444-444444444444' // Fixed UUID for business-suite
    },
    'executive-suite': {
      room_type: "Executive Suite",
      price_per_night: 54900,
      max_occupancy: 4,
      uuid: '55555555-5555-5555-5555-555555555555' // Fixed UUID for executive-suite
    }
  };

  const roomType = ROOM_TYPES[room_id];
  if (!roomType) {
    return res.status(400).json({ error: 'Invalid room type selected' });
  }

  const roomPrice = roomType.price_per_night;

  const nights = (new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24);
  if (nights <= 0) return res.status(400).json({ error: 'Invalid date range' });
  
  const base_total = Number((roomPrice * nights).toFixed(2));
  const transaction_fee = Number((base_total * 0.02).toFixed(2));
  const total_amount = base_total + transaction_fee;

  // Use UUID for database, but store original room_type_id for reference
  const roomUuid = roomType.uuid;
  
  console.log('Attempting to create booking with data:', {
    room_id: room_id, // Original room type ID
    room_uuid: roomUuid, // UUID for database
    guest_name,
    guest_email,
    base_total,
    total_amount,
    transaction_ref
  });

  let data, error;
  try {
    const result = await supabase.from('bookings').insert([
      {
        room_id: roomUuid, // Use UUID for database compatibility
        guest_name,
        guest_email,
        guest_phone,
        check_in,
        check_out,
        guests: guests || 1,
        payment_status: payment_status || 'pending',
        transaction_ref,
        status: status || 'pending',
        base_total,
        transaction_fee,
        total_amount,
        payment_method: 'flutterwave', // Online bookings use Flutterwave
        created_by_role: 'client' // Online bookings are created by clients
      }
    ]).select();
    
    data = result.data;
    error = result.error;
  } catch (insertError) {
    console.error('Supabase insert failed:', insertError);
    error = {
      message: 'Database connection failed',
      details: insertError.message,
      code: 'CONNECTION_ERROR'
    };
  }
  
  if (error) {
    console.error('Public booking creation error:', error);
    return res.status(500).json({ error: error.message });
  }
  
  res.status(201).json({ booking: data[0], base_total, transaction_fee, total_amount });
});

// POST create booking (receptionist, superadmin)
router.post('/', (req, res, next) => { console.log(`[${new Date().toISOString()}] Booking created:`, req.body); next(); }, requireRole(['receptionist', 'superadmin']), async (req, res) => {
  const {
    room_id,
    guest_name,
    guest_email,
    guest_phone,
    check_in,
    check_out,
    guests,
    payment_status,
    transaction_ref,
    status,
    reference
  } = req.body;

  // Validate required fields
  if (!room_id || !guest_name || !guest_email || !guest_phone || !check_in || !check_out) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Use same room type definitions as public booking (with UUID mappings)
  const ROOM_TYPES = {
    'classic-single': {
      room_type: "Classic Single",
      price_per_night: 24900,
      max_occupancy: 2,
      uuid: '11111111-1111-1111-1111-111111111111'
    },
    'deluxe': {
      room_type: "Deluxe",
      price_per_night: 30500,
      max_occupancy: 2,
      uuid: '22222222-2222-2222-2222-222222222222'
    },
    'deluxe-large': {
      room_type: "Deluxe Large",
      price_per_night: 35900,
      max_occupancy: 2,
      uuid: '33333333-3333-3333-3333-333333333333'
    },
    'business-suite': {
      room_type: "Business Suite",
      price_per_night: 49900,
      max_occupancy: 4,
      uuid: '44444444-4444-4444-4444-444444444444'
    },
    'executive-suite': {
      room_type: "Executive Suite",
      price_per_night: 54900,
      max_occupancy: 4,
      uuid: '55555555-5555-5555-5555-555555555555'
    }
  };

  const roomType = ROOM_TYPES[room_id];
  if (!roomType) return res.status(400).json({ error: 'Invalid room type selected' });
  
  const roomPrice = roomType.price_per_night;
  const roomUuid = roomType.uuid; // Get UUID for database
  
  const nights = (new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24);
  if (nights <= 0) return res.status(400).json({ error: 'Invalid date range' });
  
  // Declare variables outside try-catch for broader scope
  let roomInventory;
  let bookedRooms = 0;
  
  // Check room availability
  try {
    // Get room inventory (filter for active rooms)
    const { data: roomInventoryData, error: inventoryError } = await supabase
      .from('room_inventory')
      .select('available_rooms, total_rooms')
      .eq('room_type_id', room_id)
      .eq('is_active', true)
      .single();

    roomInventory = roomInventoryData;

    if (inventoryError || !roomInventory) {
      console.error('Room inventory error:', inventoryError);
      console.log('Looking for room_type_id:', room_id);
      return res.status(400).json({ 
        success: false, 
        message: `Room type '${room_id}' not found in active inventory` 
      });
    }

    // Check existing bookings for the same room type and overlapping dates
    // Booking overlap logic: new booking overlaps if:
    // 1. New check-in is before existing check-out AND
    // 2. New check-out is after existing check-in
    const { data: existingBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*')
      .eq('room_id', roomUuid)
      .lt('check_in', check_out)
      .gt('check_out', check_in)
      .not('status', 'eq', 'cancelled');

    if (bookingsError) {
      console.error('Error checking existing bookings:', bookingsError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error checking room availability' 
      });
    }

    bookedRooms = existingBookings ? existingBookings.length : 0;
    // Use total_rooms from inventory, not available_rooms (which gets updated)
    const availableRooms = roomInventory.total_rooms - bookedRooms;

    // Enhanced logging for debugging
    console.log('=== Room Availability Check ===');
    console.log('Room type:', room_id);
    console.log('Check-in:', check_in);
    console.log('Check-out:', check_out);
    console.log('Total rooms in inventory:', roomInventory.total_rooms);
    console.log('Currently booked rooms for these dates:', bookedRooms);
    console.log('Available rooms (total - booked):', availableRooms);
    console.log('Existing bookings details:', existingBookings);
    console.log('===============================');

    if (availableRooms < 1) {
      return res.status(400).json({ 
        success: false, 
        message: `No rooms available for the selected dates. ${bookedRooms} out of ${roomInventory.total_rooms} rooms already booked.`,
        debug: {
          totalRooms: roomInventory.total_rooms,
          bookedRooms,
          calculatedAvailable: availableRooms,
          checkIn: check_in,
          checkOut: check_out,
          roomType: room_id
        }
      });
    }
  } catch (availabilityError) {
    console.error('Room availability check failed:', availabilityError);
    return res.status(500).json({ 
      success: false, 
      message: 'Error checking room availability' 
    });
  }

  const base_total = Number((roomPrice * nights).toFixed(2));
  const transaction_fee = Number((base_total * 0.02).toFixed(2));
  const total_amount = base_total + transaction_fee;

  let data, error;
  try {
    const result = await supabase.from('bookings').insert([
      {
        room_id: roomUuid, // Use UUID for database compatibility
        guest_name,
        guest_email,
        guest_phone,
        check_in,
        check_out,
        guests: guests || 1,
        payment_status: payment_status || 'pending',
        transaction_ref: transaction_ref || `BK-${Date.now()}`,
        status: status || 'confirmed',
        base_total,
        transaction_fee,
        total_amount,
        payment_method: 'manual', // Manual bookings don't use online payment
        created_by_role: req.user.role // Get role from authenticated user
      }
    ]).select();
    
    data = result.data;
    error = result.error;

    // Note: Room availability is now calculated dynamically based on bookings
    // No need to update inventory since we calculate availability from total_rooms - active_bookings
    if (!error && data && data.length > 0) {
      console.log(`Booking created successfully: ${room_id} (${bookedRooms + 1} rooms now booked out of ${roomInventory.total_rooms})`);
    }
  } catch (insertError) {
    console.error('Staff booking creation error:', insertError);
    error = {
      message: 'Database connection failed',
      details: insertError.message,
      code: 'CONNECTION_ERROR'
    };
  }
  
  if (error) {
    console.error('Staff booking creation error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'Failed to create booking'
    });
  }
  
  // await sendBookingConfirmationEmail(data[0]); // Send email after successful booking
  res.status(201).json({ 
    success: true,
    booking: data[0], 
    base_total, 
    transaction_fee, 
    total_amount,
    message: 'Booking created successfully'
  });
});


// Booking statuses that should restore room to inventory
// These statuses indicate the room is no longer occupied and should be available
const ROOM_FREEING_STATUSES = [
  'checked_out',   // Guest completed stay normally
  'completed',     // Booking finished
  'cancelled',     // Booking cancelled (guest won't arrive)
  'no_show',       // Guest didn't show up
  'voided'         // Booking voided/invalidated
];

// Helper function to restore room to inventory
async function restoreRoomToInventory(roomId, roomTypeId) {
  try {
    const { data: currentInventory, error: fetchInventoryError } = await supabase
      .from('room_inventory')
      .select('available_rooms, total_rooms')
      .eq('room_type_id', roomTypeId)
      .single();

    if (fetchInventoryError) {
      console.error('Failed to fetch room inventory:', fetchInventoryError);
      return false;
    }

    if (currentInventory) {
      // Increase available room count by 1, but don't exceed total_rooms
      const newAvailableRooms = Math.min(
        (currentInventory.available_rooms || 0) + 1,
        currentInventory.total_rooms || 0
      );

      const { error: inventoryError } = await supabase
        .from('room_inventory')
        .update({ 
          available_rooms: newAvailableRooms,
          updated_at: new Date().toISOString()
        })
        .eq('room_type_id', roomTypeId);

      if (inventoryError) {
        console.error('Failed to restore room availability:', inventoryError);
        return false;
      }

      console.log(`✅ Room restored: ${roomTypeId} → ${newAvailableRooms} available`);
      return true;
    }
  } catch (error) {
    console.error('Error restoring room availability:', error);
    return false;
  }
  return false;
}

// PUT update booking status (superadmin, receptionist) 
router.put('/:id', requireRole(['superadmin', 'receptionist']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Validate status - now supporting more statuses for better tracking
    const validStatuses = ['pending', 'confirmed', 'checked_in', 'checked_out', 'completed', 'cancelled', 'no_show', 'voided'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid status. Valid statuses: ' + validStatuses.join(', ') 
      });
    }
    
    // Check if booking exists
    const { data: existingBooking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError || !existingBooking) {
      return res.status(404).json({ 
        success: false, 
        message: 'Booking not found' 
      });
    }
    
    // Update booking status
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (updateError) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update booking status' 
      });
    }

    // STATUS-BASED ROOM RESTORATION
    // If new status frees the room, restore it to inventory
    const wasRoomFreed = ROOM_FREEING_STATUSES.includes(existingBooking.status);
    const isRoomBeingFreed = ROOM_FREEING_STATUSES.includes(status);
    
    if (isRoomBeingFreed && !wasRoomFreed) {
      // Room is being freed for the first time
      try {
        const UUID_TO_ROOM_TYPE = {
          '11111111-1111-1111-1111-111111111111': 'classic-single',
          '22222222-2222-2222-2222-222222222222': 'deluxe',
          '33333333-3333-3333-3333-333333333333': 'deluxe-large',
          '44444444-4444-4444-4444-444444444444': 'business-suite',
          '55555555-5555-5555-5555-555555555555': 'executive-suite'
        };

        const roomTypeId = UUID_TO_ROOM_TYPE[existingBooking.room_id];
        if (roomTypeId) {
          await restoreRoomToInventory(existingBooking.room_id, roomTypeId);
          console.log(`📊 Status changed: ${existingBooking.status} → ${status} | Room freed ✅`);
        }
      } catch (roomError) {
        console.error('Error restoring room availability:', roomError);
        // Don't fail the status update for this
      }
    } else if (wasRoomFreed && !isRoomBeingFreed) {
      // Room was freed but now being taken back (fixing a mistake)
      console.log(`⚠️ Warning: Changing from ${existingBooking.status} to ${status} - room may need manual inventory adjustment`);
    }

    // Determine appropriate success message based on status
    let message = `Booking status updated to ${status}`;
    if (isRoomBeingFreed && !wasRoomFreed) {
      message += ' - Room returned to inventory';
    }

    res.json({ 
      success: true,
      message,
      booking: updatedBooking
    });

  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// DELETE booking (SUPERADMIN ONLY - for cancellations/errors)
// For ACTIVE bookings (not checked out): Restores room to inventory
// For CHECKED-OUT bookings: Should not be deleted (UI hides button)
// Receptionist cannot delete - only SuperAdmin
router.delete('/:id', requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // First check if booking exists
    const { data: existingBooking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError || !existingBooking) {
      return res.status(404).json({ 
        success: false, 
        message: 'Booking not found' 
      });
    }

    // ⚠️ WARNING: Prefer using status updates (cancelled, no_show, voided) instead of deletion
    // Check if booking room was already freed (checked_out, completed, cancelled, no_show, voided)
    const isRoomAlreadyFreed = ROOM_FREEING_STATUSES.includes(existingBooking.status);
    
    if (isRoomAlreadyFreed) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete bookings with freed rooms. Room has already been returned to inventory. Consider keeping for records.'
      });
    }
    
    console.warn(`⚠️ DELETING BOOKING ${id} - Consider using 'cancelled' status instead for audit trail`);
    
    // Delete the booking first
    const { error: deleteError } = await supabase
      .from('bookings')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to cancel booking' 
      });
    }
    
    // For ACTIVE bookings (not checked out), restore room availability
    // This is because the guest never actually occupied the room or it was cancelled
    if (existingBooking.room_id && existingBooking.room_type_id) {
      await restoreRoomToInventory(existingBooking.room_id, existingBooking.room_type_id);
      console.log(`✅ Room restored after deleting active booking. Room Type: ${existingBooking.room_type_id}`);
    }
    
    console.warn(`⚠️ Booking permanently deleted: ${id} - Consider using status updates for audit trail`);
    
    
    res.json({ 
      success: true, 
      message: 'Booking cancelled successfully and room returned to inventory' 
    });
    
  } catch (error) {
    console.error('Delete booking error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// GET booking by reference (all staff)
router.get('/:ref', requireRole(['superadmin', 'supervisor', 'receptionist']), async (req, res) => {
  const { ref } = req.params;
  const { data, error } = await supabase.from('bookings').select('*').eq('transaction_ref', ref).single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

module.exports = router;
