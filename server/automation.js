const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

const receiptDir = path.join(__dirname, '..', 'data', 'receipts');

async function createReceiptPdf(order) {
  await fs.promises.mkdir(receiptDir, { recursive: true });
  const filePath = path.join(receiptDir, `${order.id}.pdf`);
  const doc = new PDFDocument({ margin: 48 });
  const stream = fs.createWriteStream(filePath);

  doc.pipe(stream);
  doc.fontSize(22).text('Music Store Receipt', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Order: ${order.id}`);
  doc.text(`Customer: ${order.customer.name}`);
  doc.text(`Email: ${order.customer.email}`);
  doc.text(`Date: ${new Date(order.createdAt).toLocaleString()}`);
  doc.moveDown();

  order.items.forEach((item) => {
    doc.text(`${item.name} x ${item.quantity} - PKR ${item.lineTotal.toLocaleString()}`);
  });

  doc.moveDown();
  doc.fontSize(16).text(`Total: PKR ${order.total.toLocaleString()}`, { align: 'right' });
  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return filePath;
}

async function sendReceiptEmail(order, receiptPath) {
  if (!process.env.SMTP_HOST) {
    return {
      skipped: true,
      message: 'SMTP_HOST is not configured. Receipt PDF was generated locally.'
    };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });

  await transporter.sendMail({
    from: process.env.RECEIPT_FROM || 'receipts@music-store.test',
    to: order.customer.email,
    subject: `Your Music Store receipt ${order.id}`,
    text: `Thanks for your order. Your receipt is attached. Total: PKR ${order.total.toLocaleString()}.`,
    attachments: [{ filename: `${order.id}.pdf`, path: receiptPath }]
  });

  return { skipped: false, message: 'Receipt email sent.' };
}

module.exports = { createReceiptPdf, sendReceiptEmail };
