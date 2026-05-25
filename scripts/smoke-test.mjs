const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:8000';
const request = async (method, url, body, headers = {}) => {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${method} ${url} failed: ${response.status} ${text}`);
  }

  return data;
};

const get = (path, headers) => request('GET', `${gatewayUrl}${path}`, null, headers);
const post = (path, body, headers) => request('POST', `${gatewayUrl}${path}`, body, headers);
const put = (path, body, headers) => request('PUT', `${gatewayUrl}${path}`, body, headers);
const del = (path, headers) => request('DELETE', `${gatewayUrl}${path}`, null, headers);

const logStep = (message) => console.log(`[smoke] ${message}`);

const run = async () => {
  logStep('checking gateway and service health');
  await get('/health');
  await get('/api/v1/auth/health');
  await get('/api/v1/merchants/health');
  await get('/api/v1/orders/health');
  await get('/api/v1/delivery/health');
  await get('/api/v1/notifications/health');

  logStep('checking User CRUD through gateway');
  const suffix = Date.now();
  const registered = await post('/api/v1/auth/register', {
    email: `smoke-${suffix}@biteswift.test`,
    password: 'smoke123',
    name: 'Smoke Test User',
    role: 'CUSTOMER'
  });
  const authHeader = { authorization: `Bearer ${registered.token}` };
  await get('/api/v1/users/me', authHeader);
  await put(`/api/v1/users/${registered.user.id}`, { name: 'Smoke Test User Updated' });
  await del(`/api/v1/users/${registered.user.id}`);

  logStep('checking Merchant CRUD through gateway');
  const merchant = await post('/api/v1/merchants', {
    name: `Smoke Merchant ${suffix}`,
    description: 'Temporary merchant for smoke testing',
    address: '1 Smoke Street',
    phone: '0900000000'
  });
  await put(`/api/v1/merchants/${merchant._id}`, { description: 'Updated smoke merchant' });
  const menuItem = await post(`/api/v1/menus/${merchant._id}/items`, {
    name: 'Smoke Dish',
    price: 10000
  });
  await put(`/api/v1/menus/${merchant._id}/items/${menuItem._id}`, { isAvailable: true });
  await del(`/api/v1/menus/${merchant._id}/items/${menuItem._id}`);
  await del(`/api/v1/merchants/${merchant._id}`);

  logStep('checking checkout flow: Gateway -> Order -> Merchant -> RabbitMQ');
  const login = await post('/api/v1/auth/login', {
    email: 'customer@biteswift.com',
    password: 'customer123'
  });
  const tokenHeader = { authorization: `Bearer ${login.token}` };
  const merchants = await get('/api/v1/merchants');
  const selectedMerchant = merchants.find(item => item.menu?.some(dish => dish.isAvailable));
  if (!selectedMerchant) {
    throw new Error('No seeded merchant with available dishes found');
  }

  const selectedDish = selectedMerchant.menu.find(item => item.isAvailable);
  const orderResponse = await post('/api/v1/orders', {
    address: '123 Smoke Test Street',
    items: [{ itemId: selectedDish._id, quantity: 1 }]
  }, tokenHeader);

  await get(`/api/v1/orders/${orderResponse.order.id}`, tokenHeader);

  logStep('checking Delivery CRUD through gateway');
  const manualDelivery = await post('/api/v1/delivery', {
    orderId: 900000 + (suffix % 100000),
    status: 'SEARCHING'
  });
  await put(`/api/v1/delivery/${manualDelivery.order_id}`, { status: 'DRIVER_ASSIGNED', driverName: 'Smoke Driver' });
  await del(`/api/v1/delivery/${manualDelivery.order_id}`);

  logStep('checking Notification CRUD through gateway');
  const notification = await post('/api/v1/notifications', {
    type: 'SMOKE_TEST',
    message: 'Smoke test notification'
  });
  await put(`/api/v1/notifications/${notification.id}`, { read: true });
  await del(`/api/v1/notifications/${notification.id}`);

  logStep(`created checkout order #${orderResponse.order.id}`);
  logStep('smoke test completed successfully');
};

run().catch(error => {
  console.error(error.message);
  process.exit(1);
});
