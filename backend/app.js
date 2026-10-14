import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/authRoutes.js';
import incidentRoutes from './routes/incidentRoutes.js';
import responderRoutes from './routes/responderRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import safewalkRoutes from './routes/safewalkRoutes.js';
import falseAlarmRoutes from './routes/falseAlarmRoutes.js';
import disciplinaryRoutes from './routes/disciplinaryRoutes.js';

import { errorHandler } from './middleware/errorHandler.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { isDbConnected } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security headers with relaxed CSP for local frontend dashboard scripts
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// CORS configuration
app.use(cors({ origin: '*', credentials: true }));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// General Rate Limiter (skip in test mode)
if (process.env.NODE_ENV !== 'test') {
  app.use('/api', generalLimiter);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'CampusShield - Smart Campus Safety and Emergency Response System',
    institution: 'Kongu Engineering College, Perundurai, Erode',
    version: '1.0.0',
    dbConnected: isDbConnected(),
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

// Public config endpoint for map services
app.get('/api/config/mapbox', (req, res) => {
  res.json({
    token: process.env.MAPBOX_ACCESS_TOKEN || ''
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/responders', responderRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/safewalk', safewalkRoutes);
app.use('/api/false-alarms', falseAlarmRoutes);
app.use('/api/disciplinary-cases', disciplinaryRoutes);

// Serve frontend static files
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// Fallback for HTML routing
app.get(['/', '/login'], (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.get(['/student', '/student/dashboard', '/student.html'], (req, res) => {
  res.sendFile(path.join(frontendPath, 'student.html'));
});

app.get(['/admin', '/admin/dashboard', '/admin.html'], (req, res) => {
  res.sendFile(path.join(frontendPath, 'admin.html'));
});

app.get(['/security', '/security/dashboard', '/security.html'], (req, res) => {
  res.sendFile(path.join(frontendPath, 'security.html'));
});

// Catch unhandled API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl} - Endpoint not found.`
  });
});

// Centralized error handler
app.use(errorHandler);

export default app;
