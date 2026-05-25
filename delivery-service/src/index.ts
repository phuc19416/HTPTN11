import express, { Request, Response } from 'express';
import cors from 'cors';
import pg from 'pg';
import amqp from 'amqplib';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8004;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/biteswift_delivery';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:8001';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:8003';

app.use(cors());
app.use(express.json());

// Log middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[DELIVERY-SERVICE] ${req.method} ${req.originalUrl} - ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Database
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
});

let amqpChannel: amqp.Channel | null = null;
const EXCHANGE_NAME = 'biteswift.order.exchange';
const QUEUE_NAME = 'delivery_service_queue';

// Initialize Database
const initDatabase = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      const client = await pool.connect();
      console.log('[DELIVERY-SERVICE] Connected to PostgreSQL Database successfully.');
      
      // Create deliveries table
      await client.query(`
        CREATE TABLE IF NOT EXISTS deliveries (
          id SERIAL PRIMARY KEY,
          order_id INT UNIQUE NOT NULL,
          driver_id INT,
          driver_name VARCHAR(255),
          status VARCHAR(50) NOT NULL DEFAULT 'SEARCHING',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      console.log('[DELIVERY-SERVICE] Verified/Created "deliveries" table.');
      client.release();
      break;
    } catch (err) {
      retries -= 1;
      console.error(`[DELIVERY-SERVICE] Database connection failed. Retries left: ${retries}. Error: ${(err as Error).message}`);
      if (retries === 0) {
        console.error('[DELIVERY-SERVICE] Could not connect to database. Exiting...');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Connect to RabbitMQ & Listen to order.created
const initRabbitMQ = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      console.log(`[DELIVERY-SERVICE] Connecting to RabbitMQ at ${RABBITMQ_URL}...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      amqpChannel = await connection.createChannel();
      
      // Assert exchange and queue
      await amqpChannel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
      await amqpChannel.assertQueue(QUEUE_NAME, { durable: true });
      
      // Bind queue to order.created routing key
      await amqpChannel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'order.created');
      
      console.log(`[DELIVERY-SERVICE] Connected to RabbitMQ. Subscribed to 'order.created'.`);
      
      // Start consuming
      await amqpChannel.consume(QUEUE_NAME, async (msg) => {
        if (msg) {
          try {
            const eventPayload = JSON.parse(msg.content.toString());
            console.log(`[DELIVERY-SERVICE] Received event 'order.created' for Order #${eventPayload.orderId}`);
            
            // 1. Acknowledge and save delivery as SEARCHING
            await handleNewOrderDelivery(eventPayload);
            
            amqpChannel?.ack(msg);
          } catch (consumeError) {
            console.error('[DELIVERY-SERVICE] Error processing consumed order.created message:', consumeError);
            // Reject message but don't requeue if malformed
            amqpChannel?.reject(msg, false);
          }
        }
      });
      break;
    } catch (err) {
      retries -= 1;
      console.error(`[DELIVERY-SERVICE] RabbitMQ connection failed. Retries left: ${retries}. Error: ${(err as Error).message}`);
      if (retries === 0) {
        console.warn('[DELIVERY-SERVICE] RabbitMQ is unavailable. Delivery listening is disabled.');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Publish Delivery status updates
const publishDeliveryStatus = async (orderId: number, driverId: number, driverName: string, status: string) => {
  if (!amqpChannel) return;
  try {
    const payload = {
      orderId,
      driverId,
      driverName,
      status,
      timestamp: new Date()
    };
    const buffer = Buffer.from(JSON.stringify(payload));
    amqpChannel.publish(EXCHANGE_NAME, 'delivery.status_changed', buffer, { persistent: true });
    console.log(`[DELIVERY-SERVICE] Published event [delivery.status_changed] with status [${status}] for Order #${orderId}`);
  } catch (error) {
    console.error('[DELIVERY-SERVICE] Error publishing delivery status event:', error);
  }
};

// Async Delivery Simulation Engine
const handleNewOrderDelivery = async (order: any) => {
  const { orderId } = order;
  
  try {
    // 1. Save initial delivery record in DB
    await pool.query(
      'INSERT INTO deliveries (order_id, status) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING',
      [orderId, 'SEARCHING']
    );
    console.log(`[DELIVERY-SERVICE] Created delivery entry in 'SEARCHING' for Order #${orderId}`);
    
    // Broadcast initial state
    await publishDeliveryStatus(orderId, 0, 'Đang tìm kiếm tài xế...', 'SEARCHING');

    // 2. Start Simulation Timers (Non-blocking)
    simulateDeliveryFlow(orderId);
  } catch (error) {
    console.error(`[DELIVERY-SERVICE] Error saving initial delivery record for Order #${orderId}:`, error);
  }
};

const logToCentral = (message: string) => {
  console.log(`[DELIVERY-SERVICE] ${message}`);
  axios.post(`${USER_SERVICE_URL.replace(':8001', ':8005')}/logs`, {
    service: 'DELIVERY',
    message: message
  }).catch(() => {
    // Ignore errors if offline
  });
};

const simulateDeliveryFlow = async (orderId: number) => {
  // Step 1: Search Driver (Wait 3 seconds)
  setTimeout(async () => {
    try {
      logToCentral(`[Order #${orderId}] Đang bắt đầu tìm kiếm tài xế trống gần nhà hàng...`);
      
      let driverId = 3; // Seed driver Trần Văn Tài Xế
      let driverName = 'Trần Văn Tài Xế';
      
      try {
        // Call User Service to fetch available drivers
        const res = await axios.get(`${USER_SERVICE_URL}/users/drivers`, { timeout: 3000 });
        if (res.status === 200 && res.data.length > 0) {
          // Pick a random driver
          const randomIndex = Math.floor(Math.random() * res.data.length);
          driverId = res.data[randomIndex].id;
          driverName = res.data[randomIndex].name;
        }
      } catch (err) {
        logToCentral(`[Order #${orderId}] Không gọi được User-Service lấy DS tài xế, sử dụng tài xế mặc định.`);
      }

      // Update DB to DRIVER_ASSIGNED
      await pool.query(
        'UPDATE deliveries SET driver_id = $1, driver_name = $2, status = $3 WHERE order_id = $4',
        [driverId, driverName, 'DRIVER_ASSIGNED', orderId]
      );
      
      logToCentral(`[Order #${orderId}] Tìm thấy tài xế: ${driverName} (ID: ${driverId}). Đã giao việc.`);
      
      // REST Call: Update Order Service status to 'COOKING'
      await axios.put(`${ORDER_SERVICE_URL}/orders/${orderId}/status`, { status: 'COOKING' }).catch(e => {
        logToCentral(`[Order #${orderId}] Lỗi cập nhật trạng thái đơn hàng sang COOKING via REST API.`);
      });

      // Publish event
      await publishDeliveryStatus(orderId, driverId, driverName, 'DRIVER_ASSIGNED');

      // Step 2: Driver goes to restaurant, picks up food (Wait 5 seconds)
      setTimeout(async () => {
        try {
          logToCentral(`[Order #${orderId}] Tài xế ${driverName} đã đến nhà hàng lấy đồ ăn và bắt đầu di chuyển.`);
          
          await pool.query(
            'UPDATE deliveries SET status = $1 WHERE order_id = $2',
            ['PICKED_UP', orderId]
          );

          // REST Call: Update Order Service status to 'DELIVERING'
          await axios.put(`${ORDER_SERVICE_URL}/orders/${orderId}/status`, { status: 'DELIVERING' }).catch(e => {
            logToCentral(`[Order #${orderId}] Lỗi cập nhật trạng thái đơn hàng sang DELIVERING via REST API.`);
          });

          // Publish event
          await publishDeliveryStatus(orderId, driverId, driverName, 'PICKED_UP');

          // Step 3: Driver delivers food to customer (Wait 6 seconds)
          setTimeout(async () => {
            try {
              logToCentral(`[Order #${orderId}] Tài xế ${driverName} đã đến nơi. Giao hàng thành công cho Khách hàng!`);
              
              await pool.query(
                'UPDATE deliveries SET status = $1 WHERE order_id = $2',
                ['DELIVERED', orderId]
              );

              // REST Call: Update Order Service status to 'COMPLETED'
              await axios.put(`${ORDER_SERVICE_URL}/orders/${orderId}/status`, { status: 'COMPLETED' }).catch(e => {
                logToCentral(`[Order #${orderId}] Lỗi cập nhật trạng thái đơn hàng sang COMPLETED via REST API.`);
              });

              // Publish event
              await publishDeliveryStatus(orderId, driverId, driverName, 'DELIVERED');
            } catch (step3Error) {
              console.error(`[DELIVERY-SERVICE] Error in Delivery Step 3 for Order #${orderId}:`, step3Error);
            }
          }, 6000);

        } catch (step2Error) {
          console.error(`[DELIVERY-SERVICE] Error in Delivery Step 2 for Order #${orderId}:`, step2Error);
        }
      }, 5000);

    } catch (step1Error) {
      console.error(`[DELIVERY-SERVICE] Error in Delivery Step 1 for Order #${orderId}:`, step1Error);
    }
  }, 3000);
};

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ service: 'Delivery Service', status: 'UP', timestamp: new Date() });
});

// GET all deliveries
app.get('/delivery', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM deliveries ORDER BY created_at DESC');
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('[DELIVERY-SERVICE] Error fetching deliveries:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST create a delivery job manually
app.post('/delivery', async (req: Request, res: Response) => {
  const { orderId, driverId, driverName, status } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: 'Missing required field: orderId' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO deliveries (order_id, driver_id, driver_name, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [orderId, driverId || null, driverName || null, status || 'SEARCHING']
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[DELIVERY-SERVICE] Error creating delivery:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET delivery by order ID
app.get('/delivery/:orderId', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  try {
    const result = await pool.query('SELECT * FROM deliveries WHERE order_id = $1', [orderId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No delivery job found for this order ID' });
    }
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[DELIVERY-SERVICE] Error fetching delivery by order ID:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PUT update a delivery by order ID
app.put('/delivery/:orderId', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { driverId, driverName, status } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM deliveries WHERE order_id = $1', [orderId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'No delivery job found for this order ID' });
    }

    const current = existing.rows[0];
    const result = await pool.query(
      `UPDATE deliveries
       SET driver_id = $1, driver_name = $2, status = $3
       WHERE order_id = $4
       RETURNING *`,
      [
        driverId !== undefined ? driverId : current.driver_id,
        driverName !== undefined ? driverName : current.driver_name,
        status !== undefined ? status : current.status,
        orderId
      ]
    );

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[DELIVERY-SERVICE] Error updating delivery:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE a delivery by order ID
app.delete('/delivery/:orderId', async (req: Request, res: Response) => {
  const { orderId } = req.params;

  try {
    const result = await pool.query('DELETE FROM deliveries WHERE order_id = $1 RETURNING *', [orderId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No delivery job found for this order ID' });
    }

    return res.status(200).json({ message: 'Delivery deleted successfully', delivery: result.rows[0] });
  } catch (error) {
    console.error('[DELIVERY-SERVICE] Error deleting delivery:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, async () => {
  await initDatabase();
  await initRabbitMQ();
  console.log(`[DELIVERY-SERVICE] Delivery Service is running on port ${PORT}`);
});
