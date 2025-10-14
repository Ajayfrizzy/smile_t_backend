const express = require('express');
const router = express.Router();
const axios = require('axios');

const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;

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

// Verify payment
router.post('/verify', async (req, res) => {
  const { tx_ref, transaction_id } = req.body;
  
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
    
    const response = await axios.get(
      endpoint,
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
    );
    
    const { data } = response.data;
    
    // Check if payment was successful
    if (data.status === 'successful') {
      res.json({ 
        success: true,
        status: 'success', 
        data: data,
        message: 'Payment verified successfully'
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
    console.error('Payment verification error:', err.response?.data || err.message);
    res.status(500).json({ 
      success: false,
      error: err.response?.data?.message || err.message,
      message: 'Payment verification failed'
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