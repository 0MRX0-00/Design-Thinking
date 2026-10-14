import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth.js';

let ioInstance = null;

export const initSocketIO = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH']
    }
  });

  // Socket authentication middleware
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
      socket.handshake.query?.token;

    if (!token) {
      // Allow unauthenticated connection with restricted guest room for public status if needed
      socket.user = null;
      return next();
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      // Invalid token - continue as unauthenticated
      socket.user = null;
      next();
    }
  });

  io.on('connection', (socket) => {
    if (socket.user) {
      const { id, role, name } = socket.user;
      
      // Join user specific room
      socket.join(`user:${id}`);

      // Join role specific rooms
      if (role === 'security') {
        socket.join('role:security');
      } else if (role === 'admin') {
        socket.join('role:admin');
        socket.join('role:security'); // admins also receive security room broadcasts
      }

      console.log(`[CampusShield Socket] User connected: ${name} (${role}) [Socket ID: ${socket.id}]`);
    } else {
      console.log(`[CampusShield Socket] Guest client connected [Socket ID: ${socket.id}]`);
    }

    socket.on('disconnect', () => {
      // Clean disconnect
    });
  });

  ioInstance = io;
  return io;
};

export const getIO = () => {
  return ioInstance;
};
