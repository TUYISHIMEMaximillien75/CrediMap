const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { User, AuditLog } = require('../models');
const authMiddleware = require('../middleware/auth');
const mailer  = require('../utils/mailer');
require('dotenv').config();

// Helper: sign a JWT with user id and isAdmin
const signToken = (user) => {
  const payload = { user: { id: user.id, isAdmin: user.isAdmin } };
  return new Promise((resolve, reject) => {
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' }, (err, token) => {
      if (err) reject(err);
      else resolve(token);
    });
  });
};

// Helper: strip sensitive fields before sending to client
const safeUser = (u) => ({
  id: u.id, name: u.name, email: u.email,
  phone: u.phone, isAdmin: u.isAdmin,
  isVerified: u.isVerified, trustScore: u.trustScore,
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });

    if (await User.findOne({ where: { email } }))
      return res.status(400).json({ error: 'An account with this email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name, email, phone: phone || null,
      password: hashed, trustScore: 50,
      isAdmin: false, isVerified: false,
    });

    const token = await signToken(user);

    // Seed the trust history chart with a starting anchor point
    await AuditLog.create({
      adminId: 0,
      targetUserId: user.id,
      oldScore: 50,
      newScore: 50,
      reason: 'initial',
    });

    res.status(201).json({ message: 'Account created successfully', token, user: safeUser(user) });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ where: { email } });
    if (!user || !user.password)
      return res.status(401).json({ error: 'Invalid credentials' });

    if (!(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = await signToken(user);
    res.json({ message: 'Login successful', token, user: safeUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me — returns current authenticated user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: { exclude: ['password'] } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/auth/me — update own profile (name, phone, password)
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { name, phone, currentPassword, newPassword } = req.body;

    if (name?.trim())  user.name  = name.trim();
    if (phone !== undefined) user.phone = phone?.trim() || null;

    // Password change — requires currentPassword verification
    if (newPassword) {
      if (!currentPassword)
        return res.status(400).json({ error: 'Current password is required to set a new one' });
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch)
        return res.status(401).json({ error: 'Current password is incorrect' });
      if (newPassword.length < 6)
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
      user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();
    res.json({ message: 'Profile updated successfully', user: safeUser(user) });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/forgot-password — generate reset token, email the link
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ where: { email } });
    // Always return 200 to prevent email enumeration
    if (!user) return res.json({ message: 'If an account exists, a reset link has been sent.' });

    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    user.resetToken       = token;
    user.resetTokenExpiry = expiry;
    await user.save();

    await mailer.sendPasswordReset(user.email, user.name, token);

    res.json({ message: 'If an account exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/reset-password — validate token and set new password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)
      return res.status(400).json({ error: 'Token and new password are required' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const user = await User.findOne({ where: { resetToken: token } });
    if (!user || !user.resetTokenExpiry || new Date() > new Date(user.resetTokenExpiry))
      return res.status(400).json({ error: 'Reset link is invalid or has expired. Please request a new one.' });

    user.password         = await bcrypt.hash(newPassword, 10);
    user.resetToken       = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({ message: 'Password updated successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
