import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'biteswift_secret_key_2026';

// Map path prefix to backend service URLs
const SERVICES = {
  auth: process.env.USER_SERVICE_URL || 'http://localhost:8001',
  users: process.env.USER_SERVICE_URL || 'http://localhost:8001',
  merchants: process.env.MERCHANT_SERVICE_URL || 'http://localhost:8002',
  menus: process.env.MERCHANT_SERVICE_URL || 'http://localhost:8002',
  orders: process.env.ORDER_SERVICE_URL || 'http://localhost:8003',
  delivery: process.env.DELIVERY_SERVICE_URL || 'http://localhost:8004',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:8005',
  notifications: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:8005',
};

// Enable CORS
app.use(cors());

// Custom logger to feed our Centralized Logs panel
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logMsg = `${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`;
    console.log(`[GATEWAY] ${logMsg}`);
    
    // Fire-and-forget log push to Notification Service
    axios.post(`${SERVICES.notification}/logs`, {
      service: 'GATEWAY',
      message: logMsg
    }).catch(() => {
      // Ignore errors if notification service is offline
    });
  });
  next();
});

// JSON parser for body
app.use(express.json());

// Health Check Endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ service: 'API Gateway', status: 'UP', timestamp: new Date() });
});

// Authentication Middleware to parse JWT
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: string;
    email: string;
  };
}

const parseUserToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: string; email: string };
      req.user = decoded;
    } catch (error) {
      // Invalid token - don't crash, let downstream handle or check protection
      console.warn(`[GATEWAY] Invalid JWT token received: ${(error as Error).message}`);
    }
  }
  next();
};

app.use(parseUserToken);

const proxyToService = async (req: AuthenticatedRequest, res: Response) => {
  const serviceName = req.params.service as keyof typeof SERVICES;
  const targetUrl = SERVICES[serviceName];

  if (!targetUrl) {
    console.error(`[GATEWAY] Error: Service matching '${serviceName}' not found`);
    return res.status(404).json({ error: 'Service not found or routing not configured' });
  }

  const prefix = `/api/v1/${serviceName}`;
  const path = req.path.slice(prefix.length);
  const downstreamPath = path === '/health' ? '/health' : `/${serviceName}${path}`;

  try {
    // Clone headers and inject user details if logged in
    const headers = { ...req.headers };
    // Strip original host to avoid proxy issues
    delete headers.host;
    delete headers.connection;

    if (req.user) {
      headers['x-user-id'] = req.user.id;
      headers['x-user-role'] = req.user.role;
      headers['x-user-email'] = req.user.email;
    }

    // Forward the request to the microservice
    const response = await axios({
      method: req.method,
      url: `${targetUrl}${downstreamPath}`,
      data: req.body,
      params: req.query,
      headers: headers,
      validateStatus: () => true, // Forward all status codes back to client (4xx, 5xx etc.)
      timeout: 10000 // 10s timeout
    });

    // Copy response headers and send response
    Object.entries(response.headers).forEach(([key, value]) => {
      if (value) res.setHeader(key, value);
    });

    return res.status(response.status).send(response.data);
  } catch (error) {
    const err = error as any;
    console.error(`[GATEWAY] Proxy Error: Failed to contact ${serviceName} service at ${targetUrl}: ${err.message}`);
    return res.status(502).json({
      error: 'Bad Gateway',
      message: `Failed to communicate with downstream ${serviceName} service. It might be offline.`,
      details: err.message
    });
  }
};

// Proxy both collection routes (/api/v1/orders) and nested routes (/api/v1/orders/123).
app.all('/api/v1/:service', proxyToService);
app.all('/api/v1/:service/*', proxyToService);

// Handle non-api or invalid routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'API Gateway only routes under /api/v1/ path.' });
});

app.listen(PORT, () => {
  console.log(`[GATEWAY] API Gateway is running on port ${PORT}`);
  console.log(`[GATEWAY] Routing table:`);
  Object.entries(SERVICES).forEach(([key, url]) => {
    console.log(`  - /api/v1/${key}[/*] -> ${url}/${key}[/*]`);
  });
});
