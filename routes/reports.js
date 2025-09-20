const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: 'Too many requests, please try again later.' });
router.use(limiter);

// Export bookings to Excel
router.get('/bookings/excel', async (req, res) => {
  const { data, error } = await supabase.from('bookings').select('*');
  if (error) return res.status(500).json({ error: error.message });
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Bookings');
  worksheet.columns = [
    { header: 'ID', key: 'id' },
    { header: 'Guest Name', key: 'guest_name' },
    { header: 'Room', key: 'room_id' },
    { header: 'Check-in', key: 'check_in' },
    { header: 'Check-out', key: 'check_out' },
    { header: 'Amount Paid', key: 'amount_paid' },
    { header: 'Transaction Ref', key: 'transaction_ref' },
  ];
  worksheet.addRows(data);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=bookings.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

// Export bar sales to PDF
router.get('/barsales/pdf', async (req, res) => {
  const { data, error } = await supabase.from('bar_sales').select('*');
  if (error) return res.status(500).json({ error: error.message });
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=bar_sales.pdf');
  doc.pipe(res);
  doc.fontSize(18).text('Bar Sales Report', { align: 'center' });
  data.forEach(sale => {
    doc.fontSize(12).text(`Drink: ${sale.drink_name}, Amount: ${sale.amount}, Date: ${sale.date}`);
  });
  doc.end();
});

module.exports = router;
