const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

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
  const { data, error } = await supabase.from('bookings').select('*');
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data: data || [] });
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
        total_amount
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
  
  // Declare roomInventory variable outside try-catch for broader scope
  let roomInventory;
  
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
    const { data: existingBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*')
      .eq('room_id', roomUuid)
      .or(`check_in.lte.${check_out},check_out.gte.${check_in}`)
      .not('status', 'eq', 'cancelled');

    if (bookingsError) {
      console.error('Error checking existing bookings:', bookingsError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error checking room availability' 
      });
    }

    const bookedRooms = existingBookings ? existingBookings.length : 0;
    const availableRooms = roomInventory.available_rooms - bookedRooms;

    if (availableRooms <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No rooms available for the selected dates' 
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
        total_amount
      }
    ]).select();
    
    data = result.data;
    error = result.error;

    // If booking was successful, update room inventory
    if (!error && data && data.length > 0 && roomInventory) {
      const newAvailableRooms = roomInventory.available_rooms - 1;
      const { error: updateError } = await supabase
        .from('room_inventory')
        .update({ 
          available_rooms: Math.max(0, newAvailableRooms), // Ensure non-negative
          updated_at: new Date().toISOString()
        })
        .eq('room_type_id', room_id)
        .eq('is_active', true);

      if (updateError) {
        console.error('Failed to update room inventory:', updateError);
        // Note: In production, you might want to implement transaction rollback
      } else {
        console.log(`Updated room inventory: ${room_id} now has ${Math.max(0, newAvailableRooms)} available rooms`);
      }
    } else if (!roomInventory) {
      console.warn('roomInventory is null - skipping inventory update');
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


// DELETE booking (superadmin, receptionist)
router.delete('/:id', requireRole(['superadmin', 'receptionist']), async (req, res) => {
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
    
    // Delete the booking
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

    // Restore room availability after successful deletion
    // Extract room type from room_id UUID (using ROOM_TYPES mapping)
    const ROOM_TYPES = {
      '11111111-1111-1111-1111-111111111111': 'classic-single',
      '22222222-2222-2222-2222-222222222222': 'deluxe',
      '33333333-3333-3333-3333-333333333333': 'deluxe-large',
      '44444444-4444-4444-4444-444444444444': 'business-suite',
      '55555555-5555-5555-5555-555555555555': 'executive-suite'
    };
    
    const roomTypeId = ROOM_TYPES[existingBooking.room_id];
    
    if (roomTypeId) {
      // Get current room inventory
      const { data: roomInventory, error: inventoryError } = await supabase
        .from('room_inventory')
        .select('available_rooms')
        .eq('room_type_id', roomTypeId)
        .eq('is_active', true)
        .single();

      if (!inventoryError && roomInventory) {
        // Restore one room to available inventory
        const { error: updateError } = await supabase
          .from('room_inventory')
          .update({ 
            available_rooms: roomInventory.available_rooms + 1,
            updated_at: new Date().toISOString()
          })
          .eq('room_type_id', roomTypeId)
          .eq('is_active', true);

        if (updateError) {
          console.error('Failed to restore room availability:', updateError);
        } else {
          console.log(`Restored room availability: ${roomTypeId} now has ${roomInventory.available_rooms + 1} available rooms`);
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Booking cancelled successfully' 
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
