import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { UserRole } from '../config/constants';

let io: SocketServer;

export function initSocket(server: HttpServer): SocketServer {
  io = new SocketServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        role: UserRole;
        type: string;
      };

      if (decoded.type !== 'access') {
        return next(new Error('Authentication error: Invalid token type'));
      }

      socket.data.userId = decoded.userId;
      socket.data.role = decoded.role;
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data;
    
    logger.info('User connected to socket', { userId, role, socketId: socket.id });

    // Join private user room
    socket.join(`user:${userId}`);

    // Join role-based rooms
    if (role === 'admin') {
      socket.join('role:admin');
      socket.join('role:staff');
    } else if (role === 'cashier' || role === 'server') {
      socket.join('role:staff');
    }

    socket.on('disconnect', () => {
      logger.info('User disconnected from socket', { userId, socketId: socket.id });
    });
  });

  return io;
}

export function getIO(): SocketServer {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
}
