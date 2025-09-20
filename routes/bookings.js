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

  // Fetch room price
  const { data: roomData, error: roomError } = await supabase.from('rooms').select('price').eq('id', room_id).single();
  if (roomError || !roomData) return res.status(400).json({ error: 'Invalid room selected' });
  const nights = (new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24);
  if (nights <= 0) return res.status(400).json({ error: 'Invalid date range' });
  const base_total = Number((roomData.price * nights).toFixed(2));
  const transaction_fee = Number((base_total * 0.02).toFixed(2));
  const total_amount = base_total + transaction_fee;

  const { data, error } = await supabase.from('bookings').insert([
    {
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
      reference,
      base_total,
      transaction_fee,
      total_amount
    }
  ]);
  if (error) return res.status(500).json({ error: error.message });
  // await sendBookingConfirmationEmail(data[0]); // Send email after successful booking
  res.status(201).json({ booking: data[0], base_total, transaction_fee, total_amount });
});


// GET booking by reference (all staff)
router.get('/:ref', requireRole(['superadmin', 'supervisor', 'receptionist']), async (req, res) => {
  const { ref } = req.params;
  const { data, error } = await supabase.from('bookings').select('*').eq('transaction_ref', ref).single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

module.exports = router;
