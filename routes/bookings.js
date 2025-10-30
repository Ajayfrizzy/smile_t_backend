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

// Configure Email transporter (Gmail or Zoho)
let transporter = null;
let emailConfigured = false;
let activeEmailProvider = 'none';

// CRITICAL: Async email verification with timeout and fallback
async function initializeEmailTransporter() {
  // Check for email credentials
  if (!process.env.GMAIL_EMAIL && !process.env.ZOHO_EMAIL) {
    console.warn('⚠️ Email not configured - missing credentials');
    console.log('To enable emails, set GMAIL_EMAIL + GMAIL_PASSWORD or ZOHO_EMAIL + ZOHO_PASSWORD');
    return;
  }

  // Try Gmail first (most reliable, especially on restrictive hosting platforms like Render.com)
  if (process.env.GMAIL_EMAIL && process.env.GMAIL_PASSWORD) {
    console.log('🔍 Attempting to configure Gmail transporter...');
    console.log('📧 Gmail Email:', process.env.GMAIL_EMAIL ? 'Set ✅' : 'Not set ❌');
    console.log('🔑 Gmail Password:', process.env.GMAIL_PASSWORD ? 'Set ✅' : 'Not set ❌');
    
    const gmailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_EMAIL,
        pass: process.env.GMAIL_PASSWORD
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
      // Production-ready timeouts
      connectionTimeout: 30000, // 30 seconds
      greetingTimeout: 30000,
      socketTimeout: 60000 // 60 seconds for sending
    });
    
    try {
      // Skip verification in production - it can timeout on Railway/Render
      // but emails still work fine. Only verify in development.
      if (process.env.NODE_ENV !== 'production') {
        await Promise.race([
          gmailTransporter.verify(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Verification timeout')), 5000))
        ]);
        console.log('✅ Gmail transporter verified');
      } else {
        console.log('✅ Gmail transporter configured (skipping verification in production)');
      }
      
      transporter = gmailTransporter;
      emailConfigured = true;
      activeEmailProvider = 'gmail';
      return;
    } catch (error) {
      console.warn('⚠️ Gmail verification failed:', error.message);
      console.log('📧 Configuring Gmail anyway - emails may still work (verification can fail on restrictive hosts)');
      
      // IMPORTANT: Configure anyway - verification can fail but sending may work
      transporter = gmailTransporter;
      emailConfigured = true;
      activeEmailProvider = 'gmail';
      return;
    }
  }
  
  // Fallback to Zoho if Gmail not configured
  if (process.env.ZOHO_EMAIL && process.env.ZOHO_PASSWORD) {
    console.log('🔍 Attempting to configure Zoho transporter (fallback)...');
    console.log('📧 Zoho Email:', process.env.ZOHO_EMAIL ? 'Set ✅' : 'Not set ❌');
    console.log('🔑 Zoho Password:', process.env.ZOHO_PASSWORD ? 'Set ✅' : 'Not set ❌');
    
    const zohoTransporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465, // SSL port
      secure: true,
      auth: {
        user: process.env.ZOHO_EMAIL,
        pass: process.env.ZOHO_PASSWORD
      },
      pool: true,
      maxConnections: 3,
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 60000
    });
    
    try {
      // Skip verification in production - it can timeout on Railway/Render
      // but emails still work fine. Only verify in development.
      if (process.env.NODE_ENV !== 'production') {
        await Promise.race([
          zohoTransporter.verify(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Verification timeout')), 5000))
        ]);
        console.log('✅ Zoho transporter verified');
      } else {
        console.log('✅ Zoho transporter configured (skipping verification in production)');
      }
      
      transporter = zohoTransporter;
      emailConfigured = true;
      activeEmailProvider = 'zoho';
      return;
    } catch (error) {
      console.warn('⚠️ Zoho verification failed:', error.message);
      console.log('📧 Configuring Zoho anyway - emails may still work (verification can fail on restrictive hosts)');
      
      // IMPORTANT: Configure anyway
      transporter = zohoTransporter;
      emailConfigured = true;
      activeEmailProvider = 'zoho';
      return;
    }
  }
  
  // If we reach here, no credentials provided
  console.error('❌ CRITICAL: No email credentials provided');
  console.log('📧 Set GMAIL_EMAIL + GMAIL_PASSWORD or ZOHO_EMAIL + ZOHO_PASSWORD');
}

// Initialize email transporter (non-blocking)
initializeEmailTransporter().catch(error => {
  console.error('❌ Fatal error initializing email:', error);
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

// Send booking confirmation email - with timeout protection
async function sendBookingConfirmationEmail(booking) {
  // Skip if email not configured
  if (!emailConfigured || !transporter) {
    console.log('⚠️ Email transporter not configured - skipping booking confirmation email');
    console.log('⚠️ Check server logs for email initialization errors');
    console.log('⚠️ Ensure GMAIL_EMAIL and GMAIL_PASSWORD are set in environment variables');
    return false;
  }
  
  // Validate booking data
  if (!booking || !booking.guest_email) {
    console.error('❌ Invalid booking data for email - missing guest_email');
    console.error('❌ Booking data:', JSON.stringify(booking, null, 2));
    return false;
  }
  
  console.log(`📧 Sending email via ${activeEmailProvider.toUpperCase()} to: ${booking.guest_email}`);
  console.log(`📧 Booking ref: ${booking.transaction_ref}`);
  console.log(`📧 Guest name: ${booking.guest_name}`);
  console.log(`📧 Room: ${booking.room_name || 'Room'}`);
  
  try {
    const mailOptions = {
      from: `Smile-T Continental Hotel <${process.env.GMAIL_EMAIL || process.env.ZOHO_EMAIL}>`,
      to: booking.guest_email,
      subject: `✅ Booking Confirmation - ${booking.transaction_ref}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #7B3F00 0%, #A0522D 100%); color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 5px auto 10px;">
              Smile-T Continental Hotel
            </h1>
            <p style="margin: 10px 0 0 0;">Booking Confirmation</p>
          </div>
          
          <div style="padding: 30px; background: white; border: 1px solid #ddd;">
            <h2 style="color: #7B3F00;">Your Booking is Confirmed!</h2>
            
            <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p><strong style="color: #7B3F00;">Booking Reference:</strong> ${booking.transaction_ref}</p>
              <p><strong style="color: #7B3F00;">Guest Name:</strong> ${booking.guest_name}</p>
              <p><strong style="color: #7B3F00;">Room:</strong> ${booking.room_name || 'Room'}</p>
              <p><strong style="color: #7B3F00;">Check-in:</strong> ${new Date(booking.check_in).toLocaleDateString()}</p>
              <p><strong style="color: #7B3F00;">Check-out:</strong> ${new Date(booking.check_out).toLocaleDateString()}</p>
              <p><strong style="color: #7B3F00;">Total Amount:</strong> ₦${Number(booking.total_amount).toLocaleString()}</p>
            </div>
            
            <div style="background: #fff3cd; border-left: 4px solid #FFD700; padding: 15px; margin: 20px 0;">
              <p style="margin: 0;"><strong>📋 Important:</strong> Please present this email or your booking reference at reception during check-in.</p>
            </div>
            
            <p style="text-align: center; margin-top: 30px;">
              <strong>Contact us:</strong> +234-805-323-3660<br>
              Email: info@smile-tcontinental.com
            </p>
          </div>
          
          <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666;">
            <p>Thank you for choosing Smile-T Continental Hotel!</p>
          </div>
        </div>
      `
    };
    
    // Send email with 20-second timeout (increased for production)
    await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email timeout')), 20000)
      )
    ]);
    
    console.log(`✅ Booking confirmation email sent successfully via ${activeEmailProvider.toUpperCase()}`);
    console.log(`✅ Recipient: ${booking.guest_email}`);
    console.log(`✅ Subject: ${mailOptions.subject}`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending booking confirmation email via ${activeEmailProvider}:`, error.message);
    console.error('❌ Full error:', error);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error stack:', error.stack);
    
    // Log specific error types with actionable advice
    if (error.code === 'EAUTH') {
      console.error('❌ EAUTH: Email authentication failed');
      console.error('💡 Solution: Check that GMAIL_EMAIL and GMAIL_PASSWORD are correct');
      console.error('💡 For Gmail: Use an App Password, not your regular password');
      console.error('💡 Generate App Password at: https://myaccount.google.com/apppasswords');
    } else if (error.code === 'ETIMEDOUT' || error.message === 'Email timeout') {
      console.error('❌ TIMEOUT: Email send timeout - SMTP server slow or unreachable');
      console.error('💡 Solution: Check network connectivity and SMTP server status');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('❌ ECONNREFUSED: Email server connection refused');
      console.error('💡 Solution: SMTP server may be down or blocked by firewall');
    } else if (error.code === 'ESOCKET') {
      console.error('❌ ESOCKET: Socket error - connection interrupted');
      console.error('💡 Solution: Network issue or SMTP server disconnected');
    }
    
    // Don't throw error - email failure shouldn't break the booking flow
    return false;
  }
}

// GET all bookings (superadmin, supervisor, receptionist)
router.get('/', requireRole(['superadmin', 'supervisor', 'receptionist']), async (req, res) => {
  try {
    // Fetch bookings ordered by creation date (newest first)
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false });
      
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
  
  // ✅ Send confirmation email asynchronously for public bookings
  if (data && data[0]) {
    const bookingWithRoomInfo = {
      ...data[0],
      room_name: roomType.room_type // Add room type name for email
    };
    
    setImmediate(() => {
      sendBookingConfirmationEmail(bookingWithRoomInfo)
        .then(() => console.log('✅ Public booking confirmation email sent to:', guest_email))
        .catch(err => console.error('❌ Public booking email failed:', err.message));
    });
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
  
  // ✅ ENABLED: Send confirmation email asynchronously (don't block response)
  if (data && data[0]) {
    const bookingWithRoomInfo = {
      ...data[0],
      room_name: roomType.room_type // Add room type name for email
    };
    
    setImmediate(() => {
      sendBookingConfirmationEmail(bookingWithRoomInfo)
        .then(() => console.log('✅ Staff booking confirmation email sent to:', guest_email))
        .catch(err => console.error('❌ Staff booking email failed:', err.message));
    });
  }
  
  res.status(201).json({ 
    success: true,
    booking: data[0], 
    base_total, 
    transaction_fee, 
    total_amount,
    message: 'Booking created successfully - confirmation email will be sent'
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
  console.log(`🔧 restoreRoomToInventory called with: roomId=${roomId}, roomTypeId=${roomTypeId}`);
  
  try {
    const { data: currentInventory, error: fetchInventoryError } = await supabase
      .from('room_inventory')
      .select('available_rooms, total_rooms')
      .eq('room_type_id', roomTypeId)
      .single();

    if (fetchInventoryError) {
      console.error('❌ Failed to fetch room inventory:', fetchInventoryError);
      return false;
    }

    if (currentInventory) {
      console.log(`📊 Current inventory for ${roomTypeId}: ${currentInventory.available_rooms}/${currentInventory.total_rooms}`);
      
      // Increase available room count by 1, but don't exceed total_rooms
      const newAvailableRooms = Math.min(
        (currentInventory.available_rooms || 0) + 1,
        currentInventory.total_rooms || 0
      );

      console.log(`📊 New available rooms will be: ${newAvailableRooms}`);

      const { error: inventoryError } = await supabase
        .from('room_inventory')
        .update({ 
          available_rooms: newAvailableRooms,
          updated_at: new Date().toISOString()
        })
        .eq('room_type_id', roomTypeId);

      if (inventoryError) {
        console.error('❌ Failed to restore room availability:', inventoryError);
        return false;
      }

      console.log(`✅ Room restored successfully: ${roomTypeId} → ${newAvailableRooms} available`);
      return true;
    } else {
      console.log(`❌ No inventory found for room type: ${roomTypeId}`);
    }
  } catch (error) {
    console.error('❌ Error in restoreRoomToInventory:', error);
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

    // ===== STATUS-BASED ROOM RESTORATION =====
    // NOTE: This system uses BOTH approaches for reliability:
    // 1. MANUAL INCREMENT (this section): Updates available_rooms count in room_inventory table
    // 2. DYNAMIC CALCULATION (room-inventory.js /dashboard endpoint): Calculates from active bookings
    // 
    // Why both? The dynamic calculation is the SOURCE OF TRUTH for dashboards,
    // but we also increment/decrement for data consistency and backup.
    // If dynamic calculation fails, manual count acts as fallback.
    
    const wasRoomFreed = ROOM_FREEING_STATUSES.includes(existingBooking.status);
    const isRoomBeingFreed = ROOM_FREEING_STATUSES.includes(status);
    
    console.log(`🔍 Room Restoration Debug:
      Booking ID: ${id}
      Room ID: ${existingBooking.room_id}
      Old Status: ${existingBooking.status} (wasRoomFreed: ${wasRoomFreed})
      New Status: ${status} (isRoomBeingFreed: ${isRoomBeingFreed})
      ROOM_FREEING_STATUSES: ${JSON.stringify(ROOM_FREEING_STATUSES)}
      Action: ${isRoomBeingFreed && !wasRoomFreed ? '✅ WILL RESTORE ROOM' : '❌ NO ACTION NEEDED'}
    `);
    
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
        console.log(`🔍 Room Type Mapping: ${existingBooking.room_id} → ${roomTypeId}`);
        
        if (roomTypeId) {
          const restoreSuccess = await restoreRoomToInventory(existingBooking.room_id, roomTypeId);
          if (restoreSuccess) {
            console.log(`✅ Room manually restored to inventory: ${roomTypeId}`);
            console.log(`ℹ️ Dashboard will also calculate dynamically (excluding ${status} bookings)`);
          } else {
            console.error(`❌ Manual room restoration failed for: ${roomTypeId}`);
            console.log(`ℹ️ Dynamic calculation will still work correctly`);
          }
        } else {
          console.error(`❌ Room ID not found in UUID_TO_ROOM_TYPE mapping: ${existingBooking.room_id}`);
        }
      } catch (roomError) {
        console.error('❌ Error restoring room availability:', roomError);
        console.log(`ℹ️ Dynamic availability calculation will still work correctly`);
        // Don't fail the status update for this
      }
    } else if (wasRoomFreed && !isRoomBeingFreed) {
      // Room was freed but now being taken back (fixing a mistake)
      console.log(`⚠️ Warning: Changing from ${existingBooking.status} to ${status} - room may need manual inventory adjustment`);
    } else {
      console.log(`ℹ️ No room restoration needed (wasRoomFreed=${wasRoomFreed}, isRoomBeingFreed=${isRoomBeingFreed})`);
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
    
    // ✅ FIX: Map UUID to room_type_id (bookings table doesn't have room_type_id column)
    const UUID_TO_ROOM_TYPE = {
      '11111111-1111-1111-1111-111111111111': 'classic-single',
      '22222222-2222-2222-2222-222222222222': 'deluxe',
      '33333333-3333-3333-3333-333333333333': 'deluxe-large',
      '44444444-4444-4444-4444-444444444444': 'business-suite',
      '55555555-5555-5555-5555-555555555555': 'executive-suite'
    };
    
    if (existingBooking.room_id) {
      const roomTypeId = UUID_TO_ROOM_TYPE[existingBooking.room_id];
      if (roomTypeId) {
        await restoreRoomToInventory(existingBooking.room_id, roomTypeId);
        console.log(`✅ Room restored after deleting active booking. UUID: ${existingBooking.room_id} → Type: ${roomTypeId}`);
      } else {
        console.warn(`⚠️ Unknown room UUID: ${existingBooking.room_id} - cannot restore to inventory`);
      }
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
