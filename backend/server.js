require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { Resend } = require('resend');

const app    = express();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(express.json());
app.use(cors());

// ── Send OTP ──────────────────────────────────────────────────
app.post('/send-otp', async (req, res) => {
  const { email, passcode } = req.body;
  if (!email || !passcode) {
    return res.status(400).json({ error: 'Missing email or passcode' });
  }

  try {
    const { data, error } = await resend.emails.send({
      from:    "Shake 'n Chill <onboarding@resend.dev>",
      to:      [email],
      subject: "Your Shake 'n Chill OTP Code",
      html: `
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
      `
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`OTP sent to ${email}`, data);
    res.json({ success: true });

  } catch (err) {
    console.error('Server error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: "Shake n Chill OTP Server running" });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
