const express = require('express');
const router = express.Router();
const axios = require('axios');
const rateLimit = require('express-rate-limit');

const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: 'Too many requests, please try again later.' });
router.use(limiter);

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
        payment_options: 'card',
        customer: { email, name },
        customizations: { title: 'Hotel Booking', description: 'Room Booking Payment' }
      },
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify payment
router.get('/verify/:tx_ref', async (req, res) => {
  const { tx_ref } = req.params;
  try {
    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${tx_ref}/verify`,
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;