require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


app.get('/', (req, res) => {
  res.send('Hotel Management API is running');
});

// API routes
app.use('/rooms', require('./routes/rooms'));
app.use('/bookings', require('./routes/bookings'));
app.use('/staff', require('./routes/staff'));
app.use('/drinks', require('./routes/drinks'));
app.use('/transactions', require('./routes/transactions'));
app.use('/analytics', require('./routes/analytics'));
app.use('/reports', require('./routes/reports'));
app.use('/flutterwave', require('./routes/flutterwave'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
