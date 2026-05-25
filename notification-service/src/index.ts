import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import amqp from 'amqplib';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8005;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

interface NotificationRecord {
  id: number;
  orderId?: number;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
}

const notifications: NotificationRecord[] = [];
let nextNotificationId = 1;

app.use(cors());
app.use(express.json());

// Log middleware for notifications HTTP requests
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Avoid cluttering console if it's logging POST requests to /logs from other services
    if (req.originalUrl !== '/logs') {
      console.log(`[NOTIF-SERVICE] ${req.method} ${req.originalUrl} - ${res.statusCode} (${Date.now() - start}ms)`);
    }
  });
  next();
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ service: 'Notification Service', status: 'UP', timestamp: new Date() });
});

// Centralized Logs Endpoint: Allows other services to post logs here
// which will be broadcasted to the Admin Monitoring Dashboard in real-time
app.post('/logs', (req: Request, res: Response) => {
  const { service, message, timestamp } = req.body;
  if (!service || !message) {
    return res.status(400).json({ error: 'Missing service or message' });
  }

  const logPayload = {
    service,
    message,
    timestamp: timestamp || new Date().toISOString()
  };

  // Broadcast to all admin dashboard clients
  io.to('admin').emit('system_log', logPayload);
  return res.status(200).json({ success: true });
});

// GET all notifications
app.get('/notifications', (req: Request, res: Response) => {
  return res.status(200).json(notifications);
});

// GET notification by ID
app.get('/notifications/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const notification = notifications.find(item => item.id === id);

  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  return res.status(200).json(notification);
});

// POST create notification
app.post('/notifications', (req: Request, res: Response) => {
  const { orderId, type, message } = req.body;

  if (!type || !message) {
    return res.status(400).json({ error: 'Missing required fields: type and message' });
  }

  const notification: NotificationRecord = {
    id: nextNotificationId++,
    orderId,
    type,
    message,
    read: false,
    createdAt: new Date().toISOString()
  };

  notifications.unshift(notification);
  io.emit('notification_created', notification);
  return res.status(201).json(notification);
});

// PUT update notification
app.put('/notifications/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const notification = notifications.find(item => item.id === id);

  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  const { type, message, read } = req.body;
  if (type !== undefined) notification.type = type;
  if (message !== undefined) notification.message = message;
  if (read !== undefined) notification.read = Boolean(read);

  io.emit('notification_updated', notification);
  return res.status(200).json(notification);
});

// DELETE notification
app.delete('/notifications/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const index = notifications.findIndex(item => item.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  const [deleted] = notifications.splice(index, 1);
  io.emit('notification_deleted', deleted);
  return res.status(200).json({ message: 'Notification deleted successfully', notification: deleted });
});

// Create HTTP server for Express and Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Socket.io Connection Logic
io.on('connection', (socket) => {
  console.log(`[NOTIF-SERVICE] WebSocket client connected: ${socket.id}`);

  // Join a specific order tracking room
  socket.on('join_order', (orderId: string) => {
    socket.join(`order_${orderId}`);
    console.log(`[NOTIF-SERVICE] Client ${socket.id} joined room 'order_${orderId}'`);
  });

  // Join the admin monitoring room
  socket.on('join_admin', () => {
    socket.join('admin');
    console.log(`[NOTIF-SERVICE] Client ${socket.id} joined 'admin' dashboard room`);
  });

  socket.on('disconnect', () => {
    console.log(`[NOTIF-SERVICE] WebSocket client disconnected: ${socket.id}`);
  });
});

let amqpChannel: amqp.Channel | null = null;
const EXCHANGE_NAME = 'biteswift.order.exchange';
const QUEUE_NAME = 'notification_service_queue';

// Connect to RabbitMQ & Listen to all order + delivery events
const initRabbitMQ = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      console.log(`[NOTIF-SERVICE] Connecting to RabbitMQ at ${RABBITMQ_URL}...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      amqpChannel = connection.createChannel() as unknown as amqp.Channel;
      
      // Let's use the actual connection & create channel
      const actualChannel = await connection.createChannel();
      amqpChannel = actualChannel;

      // Assert Exchange
      await actualChannel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
      
      // Assert Queue
      await actualChannel.assertQueue(QUEUE_NAME, { durable: true });
      
      // Bind queue for order creation
      await actualChannel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'order.created');
      
      // Bind queue for delivery status updates
      await actualChannel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'delivery.status_changed');
      
      console.log(`[NOTIF-SERVICE] Connected to RabbitMQ. Bound queue for 'order.created' and 'delivery.status_changed'.`);

      // Start consuming
      await actualChannel.consume(QUEUE_NAME, (msg) => {
        if (msg) {
          try {
            const routingKey = msg.fields.routingKey;
            const content = JSON.parse(msg.content.toString());
            console.log(`[NOTIF-SERVICE] Consumed event [${routingKey}] for Order #${content.orderId}`);

            // Broadcast to specific order room
            io.to(`order_${content.orderId}`).emit('order_update', {
              event: routingKey,
              data: content
            });

            // Broadcast to admin dashboard (includes message animation flow + update list)
            io.to('admin').emit('queue_message', {
              routingKey,
              payload: content,
              timestamp: new Date()
            });

            // Auto-log this queue event so it feeds into Centralized Logs!
            const logMsg = `[AMQP] Consumed [${routingKey}] -> Order #${content.orderId} (Status: ${content.status})`;
            io.to('admin').emit('system_log', {
              service: 'RABBITMQ',
              message: logMsg,
              timestamp: new Date().toISOString()
            });

            actualChannel.ack(msg);
          } catch (consumeError) {
            console.error('[NOTIF-SERVICE] Error processing consumed message:', consumeError);
            actualChannel.reject(msg, false);
          }
        }
      });
      break;
    } catch (err) {
      retries -= 1;
      console.error(`[NOTIF-SERVICE] RabbitMQ connection failed. Retries left: ${retries}. Error: ${(err as Error).message}`);
      if (retries === 0) {
        console.warn('[NOTIF-SERVICE] RabbitMQ is offline. WebSocket notifications from queue will be disabled.');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

server.listen(PORT, async () => {
  await initRabbitMQ();
  console.log(`[NOTIF-SERVICE] Notification Service is running on port ${PORT}`);
});
export {};
