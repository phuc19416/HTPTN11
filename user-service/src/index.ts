import express, { Request, Response } from 'express';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8001;
const JWT_SECRET = process.env.JWT_SECRET || 'biteswift_secret_key_2026';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/biteswift_user';

app.use(cors());
app.use(express.json());

// Log middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[USER-SERVICE] ${req.method} ${req.originalUrl} - ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Postgres Pool
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
});

// Connect to DB with retry mechanism
const initDatabase = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      const client = await pool.connect();
      console.log('[USER-SERVICE] Connected to PostgreSQL Database successfully.');
      
      // Create users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      console.log('[USER-SERVICE] Verified/Created "users" table.');

      // Check if seed data exists, if not seed a Customer, Merchant, and Driver
      const res = await client.query('SELECT COUNT(*) FROM users');
      const count = parseInt(res.rows[0].count, 10);
      
      if (count === 0) {
        console.log('[USER-SERVICE] Seeding initial users...');
        const salt = await bcrypt.genSalt(10);
        
        const customerPassword = await bcrypt.hash('customer123', salt);
        const merchantPassword = await bcrypt.hash('merchant123', salt);
        const driverPassword = await bcrypt.hash('driver123', salt);
        
        await client.query(`
          INSERT INTO users (email, password, name, role) VALUES
          ('customer@biteswift.com', $1, 'Nguyễn Văn Khách', 'CUSTOMER'),
          ('merchant@biteswift.com', $2, 'Cơm Tấm Phúc Lộc Thọ', 'MERCHANT'),
          ('driver@biteswift.com', $3, 'Trần Văn Tài Xế', 'DRIVER')
        `, [customerPassword, merchantPassword, driverPassword]);
        
        console.log('[USER-SERVICE] Seeded: customer@biteswift.com, merchant@biteswift.com, driver@biteswift.com');
      }
      
      client.release();
      break;
    } catch (err) {
      retries -= 1;
      console.error(`[USER-SERVICE] Database connection failed. Retries left: ${retries}. Error: ${(err as Error).message}`);
      if (retries === 0) {
        console.error('[USER-SERVICE] Could not connect to database. Exiting...');
        process.exit(1);
      }
      // Wait 5 seconds before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ service: 'User & Auth Service', status: 'UP', timestamp: new Date() });
});

// Register
app.post('/auth/register', async (req: Request, res: Response) => {
  const { email, password, name, role } = req.body;
  
  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'Missing required fields (email, password, name, role)' });
  }

  const validRoles = ['CUSTOMER', 'MERCHANT', 'DRIVER'];
  if (!validRoles.includes(role.toUpperCase())) {
    return res.status(400).json({ error: 'Invalid role. Must be CUSTOMER, MERCHANT, or DRIVER.' });
  }

  try {
    const checkUser = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (checkUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const result = await pool.query(
      'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, created_at',
      [email.toLowerCase(), hashedPassword, name, role.toUpperCase()]
    );

    const newUser = result.rows[0];
    
    // Generate JWT
    const token = jwt.sign(
      { id: newUser.id, role: newUser.role, email: newUser.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: newUser
    });
  } catch (error) {
    console.error('[USER-SERVICE] Registration error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Login
app.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('[USER-SERVICE] Login error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get Current User Profile (called with x-user-id headers passed from Gateway)
app.get('/users/me', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'];
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized. Missing x-user-id header.' });
  }

  try {
    const result = await pool.query('SELECT id, email, name, role, created_at FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[USER-SERVICE] Get profile error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get all users
app.get('/users', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT id, email, name, role, created_at FROM users ORDER BY id ASC');
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('[USER-SERVICE] Get users error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get List of Drivers (used internally by Delivery Service)
app.get('/users/drivers', async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT id, name, email, role FROM users WHERE role = 'DRIVER'");
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('[USER-SERVICE] Get drivers error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get User by ID
app.get('/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT id, email, name, role, created_at FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[USER-SERVICE] Get user by ID error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update user by ID
app.put('/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { email, password, name, role } = req.body;

  const validRoles = ['CUSTOMER', 'MERCHANT', 'DRIVER'];
  if (role && !validRoles.includes(String(role).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid role. Must be CUSTOMER, MERCHANT, or DRIVER.' });
  }

  try {
    const existing = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    let hashedPassword = existing.rows[0].password;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    const result = await pool.query(
      `UPDATE users
       SET email = $1, password = $2, name = $3, role = $4
       WHERE id = $5
       RETURNING id, email, name, role, created_at`,
      [
        email ? String(email).toLowerCase() : existing.rows[0].email,
        hashedPassword,
        name || existing.rows[0].name,
        role ? String(role).toUpperCase() : existing.rows[0].role,
        id
      ]
    );

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('[USER-SERVICE] Update user error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Delete user by ID
app.delete('/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, email, name, role, created_at',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({ message: 'User deleted successfully', user: result.rows[0] });
  } catch (error) {
    console.error('[USER-SERVICE] Delete user error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, async () => {
  await initDatabase();
  console.log(`[USER-SERVICE] User Service is running on port ${PORT}`);
});
