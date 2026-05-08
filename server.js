require('dotenv').config();
const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const sanitizeBody = require('./middleware/sanitize');
const db        = require('./models');

const app = express();
const PORT = process.env.PORT || 5000;

// ── CORS ──────────────────────────────────────────────────────────────────────
// Restrict to the Vite dev frontend. In production replace with your real domain.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// General limiter: 150 requests per 15 minutes for all routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Strict limiter: 10 requests per 15 minutes for auth routes (prevents brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Please wait 15 minutes and try again.' },
});

app.use(generalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(sanitizeBody); // Strip HTML tags + trim all string fields

// ── Static Uploads ────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── HTTP + Socket.io ──────────────────────────────────────────────────────────
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTEND_ORIGIN },
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log('[Socket] New client connected:', socket.id);

  socket.on('register', (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      console.log(`[Socket] ${socket.id} joined room user_${userId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
  });
});

// ── API Health Check ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',         authLimiter, require('./routes/auth'));
app.use('/api/users',        require('./routes/users'));
app.use('/api/products',     require('./routes/products'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/reviews',      require('./routes/reviews'));
app.use('/api/engagement',   require('./routes/engagement'));
app.use('/api/admin',        require('./routes/admin'));

// ── Global Error Handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Database + Server Start ───────────────────────────────────────────────────
db.sequelize.authenticate()
  .then(() => {
    console.log('[DB] Connected successfully.');
    // alter: { drop: false } — adds new columns/tables but NEVER re-adds existing indexes.
    // This prevents the ER_TOO_MANY_KEYS crash caused by repeated alter:true runs.
    return db.sequelize.sync({ alter: { drop: false } });
  })
  .then(() => {
    console.log('[DB] Models synchronized.');
    const initTrustUpdaterCron = require('./cron/trustUpdater');
    initTrustUpdaterCron(io);
    server.listen(PORT, () => console.log(`[Server] Running on port ${PORT}`));

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PORT} is already in use.`);
        console.error('[Server] Run: netstat -ano | findstr :5000  then  taskkill /PID <pid> /F');
        process.exit(1);
      } else {
        throw err;
      }
    });
  })
  .catch(err => {
    console.error('[DB] Connection failed:', err);
    process.exit(1);
  });
