import express, { Request, Response } from 'express';
import cors from 'cors';
import pg from 'pg';
import amqp from 'amqplib';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8003;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/biteswift_order';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const MERCHANT_SERVICE_URL = process.env.MERCHANT_SERVICE_URL || 'http://localhost:8002';

app.use(cors());
app.use(express.json());

// Log middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[ORDER-SERVICE] ${req.method} ${req.originalUrl} - ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Database Connection
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
});

let amqpChannel: amqp.Channel | null = null;
const EXCHANGE_NAME = 'biteswift.order.exchange';

// Initialize Database
const initDatabase = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      const client = await pool.connect();
      console.log('[ORDER-SERVICE] Connected to PostgreSQL Database successfully.');
      
      // Create orders and order_items tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id INT NOT NULL,
          merchant_id VARCHAR(50) NOT NULL,
          merchant_name VARCHAR(255) NOT NULL,
          total_price DECIMAL(12,2) NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
          address TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS order_items (
          id SERIAL PRIMARY KEY,
          order_id INT REFERENCES orders(id) ON DELETE CASCADE,
          item_id VARCHAR(50) NOT NULL,
          name VARCHAR(255) NOT NULL,
          price DECIMAL(12,2) NOT NULL,
          quantity INT NOT NULL
        );
      `);
      
      console.log('[ORDER-SERVICE] Verified/Created "orders" and "order_items" tables.');
      client.release();
      break;
    } catch (err) {
      retries -= 1;
      console.error(`[ORDER-SERVICE] Database connection failed. Retries left: ${retries}. Error: ${(err as Error).message}`);
      if (retries === 0) {
        console.error('[ORDER-SERVICE] Could not connect to database. Exiting...');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Initialize RabbitMQ with retry mechanism
const initRabbitMQ = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      console.log(`[ORDER-SERVICE] Connecting to RabbitMQ at ${RABBITMQ_URL}...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      amqpChannel = await connection.createChannel();
      
      // Assert Exchange
      await amqpChannel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
      console.log(`[ORDER-SERVICE] Connected to RabbitMQ. Asserted exchange: ${EXCHANGE_NAME}`);
      break;
    } catch (err) {
      retries -= 1;
      console.error(`[ORDER-SERVICE] RabbitMQ connection failed. Retries left: ${retries}. Error: ${(err as Error).message}`);
      if (retries === 0) {
        console.warn('[ORDER-SERVICE] RabbitMQ is unavailable. Events will not be published.');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Publish Event
const publishEvent = async (routingKey: string, message: any) => {
  if (!amqpChannel) {
    console.error(`[ORDER-SERVICE] Cannot publish event. RabbitMQ channel is offline. Message skipped: ${routingKey}`);
    return false;
  }
  try {
    const buffer = Buffer.from(JSON.stringify(message));
    amqpChannel.publish(EXCHANGE_NAME, routingKey, buffer, { persistent: true });
    console.log(`[ORDER-SERVICE] Published event [${routingKey}] successfully.`);
    return true;
  } catch (error) {
    console.error('[ORDER-SERVICE] Error publishing message:', error);
    return false;
  }
};

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ service: 'Order Service', status: 'UP', timestamp: new Date() });
});

// GET all orders or filter by user (x-user-id)
app.get('/orders', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];

  try {
    let result;
    if (userRole === 'CUSTOMER' && userId) {
      result = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    } else {
      result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    }
    
    // Fetch items for each order and attach
    const orders = result.rows;
    for (const order of orders) {
      const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
      order.items = itemsResult.rows;
    }
    
    return res.status(200).json(orders);
  } catch (error) {
    console.error('[ORDER-SERVICE] Error getting orders:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET order by ID
app.get('/orders/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = orderResult.rows[0];
    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    order.items = itemsResult.rows;
    
    return res.status(200).json(order);
  } catch (error) {
    console.error('[ORDER-SERVICE] Error getting order by ID:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PUT update an order's editable fields
app.put('/orders/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { address, status } = req.body;

  if (address === undefined && status === undefined) {
    return res.status(400).json({ error: 'Provide at least one field to update: address or status' });
  }

  try {
    const existing = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const result = await pool.query(
      `UPDATE orders
       SET address = $1, status = $2
       WHERE id = $3
       RETURNING *`,
      [
        address !== undefined ? address : existing.rows[0].address,
        status !== undefined ? status : existing.rows[0].status,
        id
      ]
    );

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[ORDER-SERVICE] Error updating order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE an order and its items
app.delete('/orders/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    return res.status(200).json({ message: 'Order deleted successfully', order: result.rows[0] });
  } catch (error) {
    console.error('[ORDER-SERVICE] Error deleting order:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST Create Order (Checkout)
app.post('/orders', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized. Missing x-user-id header.' });
  }

  const { items, address } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0 || !address) {
    return res.status(400).json({ error: 'Missing or invalid fields. Expected { items: [{ itemId, quantity }], address }' });
  }

  const dbClient = await pool.connect();
  try {
    let totalPrice = 0;
    let merchantId = '';
    let merchantName = '';
    
    // 1. SYNC REST Validation: Check items against Merchant Service
    const validatedItems = [];
    
    for (const cartItem of items) {
      const { itemId, quantity } = cartItem;
      if (!itemId || !quantity || quantity <= 0) {
        return res.status(400).json({ error: 'Invalid item id or quantity in cart.' });
      }

      console.log(`[ORDER-SERVICE] REST Call: Validating menu item ${itemId} with Merchant Service...`);
      // Sync REST API Call to Merchant Service
      const itemResponse = await axios.get(`${MERCHANT_SERVICE_URL}/menus/items/${itemId}`, {
        validateStatus: () => true,
        timeout: 5000
      });
      
      if (itemResponse.status !== 200) {
        return res.status(400).json({ error: `Dish item ${itemId} is no longer valid or does not exist.` });
      }

      const { item, merchant } = itemResponse.data;
      
      if (!item.isAvailable) {
        return res.status(400).json({ error: `Dish '${item.name}' is currently sold out.` });
      }

      // Check merchant matching (all items in a cart must belong to the same merchant)
      if (!merchantId) {
        merchantId = merchant.id;
        merchantName = merchant.name;
      } else if (merchantId !== merchant.id) {
        return res.status(400).json({ error: 'All dishes in a cart must come from the same restaurant.' });
      }

      const itemTotalPrice = Number(item.price) * quantity;
      totalPrice += itemTotalPrice;

      validatedItems.push({
        itemId: item._id,
        name: item.name,
        price: Number(item.price),
        quantity
      });
    }

    // 2. Database transaction to save order
    await dbClient.query('BEGIN');
    
    const orderInsertResult = await dbClient.query(
      `INSERT INTO orders (user_id, merchant_id, merchant_name, total_price, status, address)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, merchantId, merchantName, totalPrice, 'PENDING', address]
    );
    
    const createdOrder = orderInsertResult.rows[0];
    
    // Insert order items
    for (const vi of validatedItems) {
      await dbClient.query(
        `INSERT INTO order_items (order_id, item_id, name, price, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [createdOrder.id, vi.itemId, vi.name, vi.price, vi.quantity]
      );
    }
    
    await dbClient.query('COMMIT');
    createdOrder.items = validatedItems;

    console.log(`[ORDER-SERVICE] Saved order #${createdOrder.id} to DB.`);

    // 3. ASYNC communication: Publish event order.created
    const eventPayload = {
      orderId: createdOrder.id,
      userId: Number(userId),
      merchantId,
      merchantName,
      totalPrice,
      status: 'PENDING',
      address,
      items: validatedItems,
      createdAt: createdOrder.created_at
    };
    
    await publishEvent('order.created', eventPayload);

    return res.status(201).json({
      message: 'Order placed successfully. Waiting for driver assignment.',
      order: createdOrder
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('[ORDER-SERVICE] Checkout Error:', error);
    return res.status(500).json({ error: 'Failed to process order creation' });
  } finally {
    dbClient.release();
  }
});

// REST Endpoint to update order status (called internally by Delivery Service or Admin)
app.put('/orders/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Missing status' });
  }

  try {
    const result = await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updatedOrder = result.rows[0];
    console.log(`[ORDER-SERVICE] Sync REST Update: Order #${id} status updated to [${status}]`);
    return res.status(200).json(updatedOrder);
  } catch (error) {
    console.error('[ORDER-SERVICE] Error updating order status:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, async () => {
  await initDatabase();
  await initRabbitMQ();
  console.log(`[ORDER-SERVICE] Order Service is running on port ${PORT}`);
});
export {};
