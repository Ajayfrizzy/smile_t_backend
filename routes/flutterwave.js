const express = require('express');
const router = express.Router();
const axios = require('axios');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configure Email transporter (Gmail or Zoho)
// Make transporter optional if email credentials are not configured
let transporter = null;
if ((process.env.GMAIL_EMAIL && process.env.GMAIL_PASSWORD) || (process.env.ZOHO_EMAIL && process.env.ZOHO_PASSWORD)) {
  try {
    // Prefer Gmail (more reliable) over Zoho
    if (process.env.GMAIL_EMAIL && process.env.GMAIL_PASSWORD) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_EMAIL,
          pass: process.env.GMAIL_PASSWORD
        }
      });
      console.log('✅ Email transporter configured (Gmail)');
    } else {
      // Fallback to Zoho
      transporter = nodemailer.createTransport({
        host: 'smtp.zoho.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.ZOHO_EMAIL,
          pass: process.env.ZOHO_PASSWORD
        },
        tls: {
          ciphers: 'SSLv3',
          rejectUnauthorized: false
        }
      });
      console.log('✅ Email transporter configured (Zoho SMTP - Port 587)');
    }
  } catch (err) {
    console.error('❌ Error creating email transporter:', err.message);
    transporter = null;
  }
} else {
  console.warn('⚠️ Email credentials not configured - emails will not be sent');
}

// Send booking confirmation email - OPTIMIZED with timeout
async function sendBookingConfirmationEmail(booking) {
  // Skip if email not configured
  if (!transporter) {
    console.log('ℹ️ Email not configured - skipping confirmation email');
    return false;
  }
  
  // Validate booking data
  if (!booking || !booking.guest_email) {
    console.error('❌ Invalid booking data for email - missing guest_email');
    return false;
  }
  
  try {
    // Room type mappings for email
    const ROOM_TYPES = {
      '11111111-1111-1111-1111-111111111111': 'Classic Single',
      '22222222-2222-2222-2222-222222222222': 'Deluxe',
      '33333333-3333-3333-3333-333333333333': 'Deluxe Large',
      '44444444-4444-4444-4444-444444444444': 'Business Suite',
      '55555555-5555-5555-5555-555555555555': 'Executive Suite'
    };

    const roomName = ROOM_TYPES[booking.room_id] || 'Room';
    
    const senderEmail = process.env.GMAIL_EMAIL || process.env.ZOHO_EMAIL;
    const mailOptions = {
      from: `Smile-T Continental Hotel <${senderEmail}>`,
      to: booking.guest_email,
      subject: `✅ Booking Confirmation - ${booking.transaction_ref}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #7B3F00 0%, #A0522D 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .content { background: white; padding: 30px; border: 1px solid #ddd; }
            .success-icon { font-size: 60px; text-align: center; margin: 20px 0; }
            .booking-details { background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
            .detail-label { font-weight: bold; color: #7B3F00; }
            .detail-value { color: #333; }
            .total { background: #FFD700; padding: 15px; border-radius: 8px; text-align: center; font-size: 20px; font-weight: bold; color: #7B3F00; margin: 20px 0; }
            .footer { background: #f5f5f5; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; font-size: 14px; color: #666; }
            .button { display: inline-block; background: #7B3F00; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🏨 Smile-T Continental Hotel</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px;">Booking Confirmation</p>
            </div>
            
            <div class="content">
              <div class="success-icon">✅</div>
              
              <h2 style="color: #7B3F00; text-align: center;">Payment Successful!</h2>
              <p style="text-align: center; color: #666;">Thank you for choosing Smile-T Continental Hotel. Your booking has been confirmed.</p>
              
              <div class="booking-details">
                <h3 style="color: #7B3F00; margin-top: 0;">Booking Details</h3>
                
                <div class="detail-row">
                  <span class="detail-label">Booking Reference:</span>
                  <span class="detail-value"><strong>${booking.transaction_ref}</strong></span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Guest Name:</span>
                  <span class="detail-value">${booking.guest_name}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Email:</span>
                  <span class="detail-value">${booking.guest_email}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Phone:</span>
                  <span class="detail-value">${booking.guest_phone}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Room Type:</span>
                  <span class="detail-value">${roomName}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Check-in Date:</span>
                  <span class="detail-value">${new Date(booking.check_in).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                
                <div class="detail-row">
                  <span class="detail-label">Check-out Date:</span>
                  <span class="detail-value">${new Date(booking.check_out).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                
                <div class="detail-row" style="border: none;">
                  <span class="detail-label">Number of Guests:</span>
                  <span class="detail-value">${booking.guests || 1}</span>
                </div>
              </div>
              
              <div class="total">
                Total Amount Paid: ₦${Number(booking.total_amount).toLocaleString()}
              </div>
              
              <div style="background: #fff3cd; border-left: 4px solid #FFD700; padding: 15px; margin: 20px 0;">
                <strong>📋 Important:</strong>
                <ul style="margin: 10px 0; padding-left: 20px;">
                  <li>Please present this email or your booking reference at reception during check-in</li>
                  <li>Check-in time: 2:00 PM</li>
                  <li>Check-out time: 12:00 PM</li>
                  <li>Valid ID required at check-in</li>
                </ul>
              </div>
              
              <p style="text-align: center;">
                <strong>Need to make changes?</strong><br>
                Contact us: +234-805-323-3660<br>
                Email: info@smile-tcontinental.com
              </p>
            </div>
            
            <div class="footer">
              <p><strong>Smile-T Continental Hotel</strong></p>
              <p>Thank you for choosing us. We look forward to hosting you!</p>
              <p style="font-size: 12px; color: #999; margin-top: 20px;">
                This is an automated confirmation email. Please do not reply to this email.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    
    // Send email with 15 second timeout
    await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email timeout')), 15000)
      )
    ]);
    
    console.log('✅ Booking confirmation email sent to:', booking.guest_email);
    return true;
  } catch (error) {
    console.error('❌ Error sending booking confirmation email:', error.message);
    
    // Log specific error types
    if (error.code === 'EAUTH') {
      console.error('❌ Email authentication failed - check credentials');
    } else if (error.code === 'ETIMEDOUT' || error.message === 'Email timeout') {
      console.error('❌ Email send timeout - SMTP server slow');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('❌ Email server connection refused');
    }
    
    // Don't throw error - email failure shouldn't break the booking flow
    return false;
  }
}

// Initialize payment
router.post('/initiate', async (req, res) => {
  const { amount, email, name, tx_ref, redirect_url } = req.body;
  try {
    const response = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref,
        amount,
        currency: 'NGN',
        redirect_url,
        payment_options: 'card,mobilemoney,ussd',
        customer: { email, name },
        customizations: { 
          title: 'Smile-T Hotel Booking', 
          description: 'Hotel Room Booking Payment' 
        }
      },
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
    );
    res.json(response.data);
  } catch (err) {
    console.error('Payment initiation error:', err.response?.data || err.message);
    res.status(500).json({ 
      success: false,
      error: err.response?.data?.message || err.message 
    });
  }
});

// Verify payment - OPTIMIZED for speed
router.post('/verify', async (req, res) => {
  const { tx_ref, transaction_id } = req.body;
  
  console.log('🔍 Payment verification requested:', { tx_ref, transaction_id });
  
  if (!tx_ref && !transaction_id) {
    return res.status(400).json({ 
      success: false,
      error: 'Transaction reference or transaction ID is required' 
    });
  }

  try {
    // Use transaction_id if available, otherwise use tx_ref
    const identifier = transaction_id || tx_ref;
    const endpoint = transaction_id 
      ? `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`
      : `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`;
    
    console.log('📡 Calling Flutterwave API:', endpoint);
    
    const response = await axios.get(
      endpoint,
      { 
        headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
        timeout: 10000 // 10 second timeout
      }
    );
    
    const { data } = response.data;
    
    console.log('💳 Payment status from Flutterwave:', data.status);
    
    // Check if payment was successful
    if (data.status === 'successful') {
      console.log('✅ Payment verified successfully');
      
      // RESPOND IMMEDIATELY to frontend (don't wait for DB/email)
      // This makes the UX much faster
      res.json({ 
        success: true,
        status: 'success', 
        data: data,
        message: 'Payment verified successfully'
      });
      
      // Update booking status in background (after response sent)
      setImmediate(async () => {
        try {
          const { data: bookings, error: fetchError } = await supabase
            .from('bookings')
            .select('*')
            .eq('transaction_ref', tx_ref)
            .single();

          if (!fetchError && bookings) {
            const booking = bookings;
            
            console.log('📋 Booking found:', { 
              id: booking.id, 
              guest: booking.guest_name,
              current_status: booking.payment_status 
            });
            
            // Only update if not already confirmed (prevent duplicate emails)
            if (booking.payment_status !== 'paid') {
              // Update booking status to confirmed and paid
              const { error: updateError } = await supabase
                .from('bookings')
                .update({
                  payment_status: 'paid',
                  status: 'confirmed',
                  updated_at: new Date().toISOString()
                })
                .eq('transaction_ref', tx_ref);

              if (!updateError) {
                console.log('✅ Booking status updated to confirmed for:', tx_ref);
                
                // Send confirmation email asynchronously (don't wait)
                sendBookingConfirmationEmail(booking)
                  .then(() => console.log('✅ Confirmation email sent successfully'))
                  .catch(err => console.error('❌ Email send failed:', err.message));
              } else {
                console.error('❌ Error updating booking status:', updateError);
              }
            } else {
              console.log('ℹ️ Booking already confirmed, skipping update:', tx_ref);
            }
          } else {
            console.warn('⚠️ Booking not found for transaction reference:', tx_ref);
            if (fetchError) {
              console.error('Database fetch error:', fetchError);
            }
          }
        } catch (dbError) {
          console.error('❌ Background booking update error:', dbError);
        }
      });
      
    } else {
      res.json({ 
        success: false,
        status: data.status,
        message: 'Payment verification failed',
        data: data
      });
    }
  } catch (err) {
    console.error('❌ Payment verification error:', err.response?.data || err.message);
    
    // More detailed error response
    const errorMessage = err.response?.data?.message || err.message || 'Unknown error';
    const errorDetails = err.response?.data || {};
    
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      message: 'Payment verification failed - please contact support',
      details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
    });
  }
});

// Webhook for Flutterwave to notify us of payment status
router.post('/webhook', async (req, res) => {
  const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
  const signature = req.headers['verif-hash'];

  if (!signature || signature !== secretHash) {
    // This request isn't from Flutterwave; discard
    return res.status(401).end();
  }

  const payload = req.body;
  console.log('Flutterwave webhook received:', payload);

  // It's a good idea to log all received events.
  // You can process the payload here to update booking status
  
  res.status(200).end();
});

module.exports = router;