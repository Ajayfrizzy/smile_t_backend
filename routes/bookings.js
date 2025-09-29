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
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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


// GET booking by reference (all staff)
router.get('/:ref', requireRole(['superadmin', 'supervisor', 'receptionist']), async (req, res) => {
  const { ref } = req.params;
  const { data, error } = await supabase.from('bookings').select('*').eq('transaction_ref', ref).single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

module.exports = router;
