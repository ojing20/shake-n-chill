require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(cors());

// ── Gmail transporter ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   'smtp.gmail.com',
  port:   465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  tls: { rejectUnauthorized: false }
});

// ── Send OTP ──────────────────────────────────────────────────
app.post('/send-otp', async (req, res) => {
  const { email, passcode } = req.body;
  if (!email || !passcode) {
    return res.status(400).json({ error: 'Missing email or passcode' });
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;
                padding:2rem;background:#f0f9ff;border-radius:12px;">
      <div style="text-align:center;margin-bottom:1.5rem;">
        <h2 style="color:#0ea5e9;margin:0;">🧋 Shake 'n Chill</h2>
        <p style="color:#64748b;font-size:.875rem;">Inventory Management System</p>
      </div>
      <div style="background:#fff;border-radius:8px;padding:1.5rem;text-align:center;">
        <p style="color:#0f172a;font-size:1rem;margin-bottom:1rem;">
          Your One-Time Password:
        </p>
        <div style="font-size:2.5rem;font-weight:800;letter-spacing:.4em;
                    color:#0284c7;background:#e0f2fe;padding:.75rem 1.5rem;
                    border-radius:8px;display:inline-block;margin-bottom:1rem;">
          ${passcode}
        </div>
        <p style="color:#64748b;font-size:.8125rem;">
          Valid for 5 minutes. Do not share this code.
        </p>
      </div>
      <p style="color:#94a3b8;font-size:.75rem;text-align:center;margin-top:1.5rem;">
        If you didn't request this, please ignore this email.
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from:    `"Shake 'n Chill" <${process.env.GMAIL_USER}>`,
      to:      email,
      subject: "Your Shake 'n Chill OTP Code",
      html
    });
    console.log(`[Gmail] OTP sent to ${email}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Gmail] Failed:', err.message);
    // Return code for screen display fallback
    return res.json({
      success:  false,
      fallback: true,
      code:     passcode,
      message:  err.message
    });
  }
});

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Shake n Chill OTP Server running' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
