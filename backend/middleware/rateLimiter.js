import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP, please try again after 15 minutes.'
  }
});

export const emergencyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // allow rapid reporting during actual emergencies, but block DoS spam
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Emergency request threshold reached. Please wait a moment before sending another alert.'
  }
});

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
