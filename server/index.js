const path = require('path');
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const { readDb, writeDb, createId } = require('./db');
const { signUser, requireAuth, allowRoles } = require('./auth');
const { createReceiptPdf, sendReceiptEmail } = require('./automation');

const app = express();
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const adminRoles = ['admin', 'employee'];

function requireFields(payload, fields) {
  return fields.filter((field) => !payload[field]);
}

function activityLog(req, action, details) {
  return {
    id: createId('act'),
    userId: req.user ? req.user.sub : 'system',
    role: req.user ? req.user.role : 'system',
    action,
    details,
    createdAt: new Date().toISOString()
  };
}

function inventoryLog(product, change, reason, actorId, referenceId) {
  return {
    id: createId('invlog'),
    productId: product.id,
    productName: product.name,
    change,
    quantityAfter: product.quantity,
    reason,
    actorId,
    referenceId,
    createdAt: new Date().toISOString()
  };
}

function normalizeDb(db) {
  db.customers = db.customers || [];
  db.orders = db.orders || [];
  db.orderItems = db.orderItems || [];
  db.sales = db.sales || [];
  db.inventoryLogs = db.inventoryLogs || [];
  db.employeeActivityLogs = db.employeeActivityLogs || [];
  db.suppliers = db.suppliers || [];
  return db;
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'app.html'));
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const db = normalizeDb(await readDb());
  const user = db.users.find((candidate) => candidate.username === username && candidate.password === password);

  if (!user) {
    return res.status(401).json({ message: 'Invalid username or password.' });
  }

  const { password: _password, ...safeUser } = user;
  return res.json({ token: signUser(user), user: safeUser });
});

app.post('/api/auth/register', async (req, res) => {
  const db = normalizeDb(await readDb());
  const { firstName, lastName, email, username, password } = req.body;
  const missing = requireFields(req.body, ['firstName', 'lastName', 'email', 'username', 'password']);

  if (missing.length) {
    return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}.` });
  }

  if (db.users.some((user) => user.username === username || user.email === email)) {
    return res.status(409).json({ message: 'A user with this email or username already exists.' });
  }

  const user = {
    id: createId('u'),
    firstName,
    lastName,
    email,
    username,
    password,
    role: 'customer'
  };
  const customer = {
    id: createId('cust'),
    userId: user.id,
    name: `${firstName} ${lastName}`,
    email,
    phone: '',
    address: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.users.push(user);
  db.customers.push(customer);
  await writeDb(db);
  const { password: _password, ...safeUser } = user;
  return res.status(201).json({ token: signUser(user), user: safeUser });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const db = normalizeDb(await readDb());
  const user = db.users.find((candidate) => candidate.id === req.user.sub);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const { password: _password, ...safeUser } = user;
  return res.json(safeUser);
});

app.get('/api/products', async (_req, res) => {
  const db = normalizeDb(await readDb());
  return res.json(db.inventory);
});

app.get('/api/products/:id', async (req, res) => {
  const db = normalizeDb(await readDb());
  const product = db.inventory.find((item) => item.id === req.params.id);

  if (!product) {
    return res.status(404).json({ message: 'Product not found.' });
  }

  return res.json(product);
});

app.post('/api/products', requireAuth, allowRoles(...adminRoles), async (req, res) => {
  const db = normalizeDb(await readDb());
  const missing = requireFields(req.body, ['name', 'price']);

  if (missing.length) {
    return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}.` });
  }

  const product = {
    id: req.body.id || createId('p'),
    name: req.body.name,
    category: req.body.category || 'Instrument',
    quantity: Number(req.body.quantity || 0),
    lowStockThreshold: Number(req.body.lowStockThreshold || 5),
    price: Number(req.body.price || 0),
    image: req.body.image || '',
    description: req.body.description || 'A premium music-store selection curated for expressive performance.',
    details: req.body.details || ['Premium build quality', 'Inspected before dispatch', 'Eligible for store support'],
    spotifyPreviewUrl: req.body.spotifyPreviewUrl || '',
    updatedAt: new Date().toISOString()
  };

  db.inventory.push(product);
  db.inventoryLogs.unshift(inventoryLog(product, product.quantity, 'Product created', req.user.sub, product.id));
  db.employeeActivityLogs.unshift(activityLog(req, 'Created product', `${product.name} was added to inventory.`));
  await writeDb(db);
  return res.status(201).json(product);
});

app.put('/api/products/:id', requireAuth, allowRoles(...adminRoles), async (req, res) => {
  const db = normalizeDb(await readDb());
  const index = db.inventory.findIndex((product) => product.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: 'Product not found.' });
  }

  const previousQuantity = Number(db.inventory[index].quantity || 0);
  db.inventory[index] = {
    ...db.inventory[index],
    ...req.body,
    quantity: Number(req.body.quantity ?? db.inventory[index].quantity),
    price: Number(req.body.price ?? db.inventory[index].price),
    lowStockThreshold: Number(req.body.lowStockThreshold ?? db.inventory[index].lowStockThreshold),
    updatedAt: new Date().toISOString()
  };

  const quantityChange = db.inventory[index].quantity - previousQuantity;
  if (quantityChange !== 0) {
    db.inventoryLogs.unshift(inventoryLog(db.inventory[index], quantityChange, 'Inventory updated by staff', req.user.sub, db.inventory[index].id));
  }
  db.employeeActivityLogs.unshift(activityLog(req, 'Updated product', `${db.inventory[index].name} was updated.`));

  await writeDb(db);
  return res.json(db.inventory[index]);
});

app.get('/api/dashboard', requireAuth, allowRoles(...adminRoles), async (_req, res) => {
  const db = normalizeDb(await readDb());
  const lowStock = db.inventory.filter((product) => product.quantity <= product.lowStockThreshold);
  const revenue = db.sales.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const categoryStock = db.inventory.reduce((result, product) => {
    result[product.category] = (result[product.category] || 0) + Number(product.quantity || 0);
    return result;
  }, {});
  const recentSales = db.sales.slice(0, 8).reverse().map((sale) => ({
    label: new Date(sale.createdAt).toLocaleDateString(),
    total: Number(sale.total || 0)
  }));

  return res.json({
    totalSales: db.sales.length,
    totalCustomers: db.users.filter((user) => user.role === 'customer').length,
    totalProducts: db.inventory.length,
    totalOrders: db.orders.length,
    revenue,
    lowStock,
    categoryStock,
    recentSales,
    recentActivity: db.employeeActivityLogs.slice(0, 6),
    inventoryLogs: db.inventoryLogs.slice(0, 8)
  });
});

app.get('/api/sales', requireAuth, allowRoles(...adminRoles), async (_req, res) => {
  const db = normalizeDb(await readDb());
  return res.json(db.sales);
});

app.post('/api/sales', requireAuth, allowRoles(...adminRoles), async (req, res) => {
  const db = normalizeDb(await readDb());
  const product = db.inventory.find((item) => item.id === req.body.productId);
  const quantity = Number(req.body.quantity || 1);

  if (!product) {
    return res.status(404).json({ message: 'Product not found.' });
  }

  if (product.quantity < quantity) {
    return res.status(409).json({ message: 'Not enough stock available.' });
  }

  product.quantity -= quantity;
  product.updatedAt = new Date().toISOString();
  const sale = {
    id: createId('sale'),
    source: 'staff',
    productId: product.id,
    productName: product.name,
    customer: {
      name: req.body.customerName || 'Walk-in customer',
      email: req.body.customerEmail || '',
      phone: req.body.customerPhone || ''
    },
    customerName: req.body.customerName || 'Walk-in customer',
    quantity,
    total: product.price * quantity,
    items: [{
      productId: product.id,
      name: product.name,
      quantity,
      price: product.price,
      lineTotal: product.price * quantity
    }],
    createdAt: new Date().toISOString()
  };

  db.sales.unshift(sale);
  db.inventoryLogs.unshift(inventoryLog(product, -quantity, 'Staff sale', req.user.sub, sale.id));
  db.employeeActivityLogs.unshift(activityLog(req, 'Recorded sale', `${quantity} x ${product.name} sold.`));
  await writeDb(db);
  return res.status(201).json(sale);
});

app.get('/api/customers', requireAuth, allowRoles(...adminRoles), async (_req, res) => {
  const db = normalizeDb(await readDb());
  return res.json(db.customers);
});

app.get('/api/orders', requireAuth, allowRoles(...adminRoles), async (_req, res) => {
  const db = normalizeDb(await readDb());
  return res.json(db.orders);
});

app.get('/api/orders/my', requireAuth, allowRoles('customer'), async (req, res) => {
  const db = normalizeDb(await readDb());
  return res.json(db.orders.filter((order) => order.userId === req.user.sub));
});

app.get('/api/activity', requireAuth, allowRoles(...adminRoles), async (_req, res) => {
  const db = normalizeDb(await readDb());
  return res.json({
    inventoryLogs: db.inventoryLogs,
    employeeActivityLogs: db.employeeActivityLogs
  });
});

app.post('/api/checkout', requireAuth, allowRoles('customer'), async (req, res) => {
  const db = normalizeDb(await readDb());
  const cartItems = req.body.items || [];
  const customer = req.body.customer || {};
  const orderItems = [];
  const missing = requireFields(customer, ['name', 'email', 'address']);

  if (!cartItems.length) {
    return res.status(400).json({ message: 'Your cart is empty.' });
  }

  if (missing.length) {
    return res.status(400).json({ message: `Missing customer fields: ${missing.join(', ')}.` });
  }

  for (const cartItem of cartItems) {
    const product = db.inventory.find((item) => item.id === cartItem.productId);
    const quantity = Number(cartItem.quantity || 1);

    if (!product) {
      return res.status(404).json({ message: `Product ${cartItem.productId} was not found.` });
    }

    if (product.quantity < quantity) {
      return res.status(409).json({ message: `${product.name} does not have enough stock.` });
    }

    orderItems.push({
      productId: product.id,
      name: product.name,
      quantity,
      price: product.price,
      lineTotal: product.price * quantity
    });
  }

  orderItems.forEach((item) => {
    const product = db.inventory.find((candidate) => candidate.id === item.productId);
    product.quantity -= item.quantity;
    product.updatedAt = new Date().toISOString();
  });

  const total = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
  let payment = { mode: 'mock', status: 'succeeded' };

  if (stripe && req.body.paymentMethodId) {
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: 'pkr',
      payment_method: req.body.paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
    });
    payment = { mode: 'stripe-test', status: intent.status, id: intent.id };
  }

  const now = new Date().toISOString();
  let customerRecord = db.customers.find((item) => item.userId === req.user.sub || item.email === customer.email);
  if (customerRecord) {
    customerRecord.name = customer.name;
    customerRecord.email = customer.email;
    customerRecord.phone = customer.phone || customerRecord.phone || '';
    customerRecord.address = customer.address;
    customerRecord.updatedAt = now;
  } else {
    customerRecord = {
      id: createId('cust'),
      userId: req.user.sub,
      name: customer.name,
      email: customer.email,
      phone: customer.phone || '',
      address: customer.address,
      createdAt: now,
      updatedAt: now
    };
    db.customers.push(customerRecord);
  }

  const order = {
    id: createId('order'),
    userId: req.user.sub,
    customerId: customerRecord.id,
    customer: customerRecord,
    items: orderItems,
    total,
    payment,
    status: 'confirmed',
    createdAt: now
  };
  const sale = {
    id: createId('sale'),
    source: 'online-order',
    orderId: order.id,
    customerId: customerRecord.id,
    customer: customerRecord,
    customerName: customerRecord.name,
    quantity: orderItems.reduce((sum, item) => sum + item.quantity, 0),
    total,
    items: orderItems,
    createdAt: now
  };

  db.orders.unshift(order);
  db.orderItems.unshift(...orderItems.map((item) => ({
    id: createId('orderitem'),
    orderId: order.id,
    ...item
  })));
  db.sales.unshift(sale);
  orderItems.forEach((item) => {
    const product = db.inventory.find((candidate) => candidate.id === item.productId);
    db.inventoryLogs.unshift(inventoryLog(product, -item.quantity, 'Customer checkout', req.user.sub, order.id));
  });
  await writeDb(db);

  const receiptPath = await createReceiptPdf(order);
  const email = await sendReceiptEmail(order, receiptPath);
  return res.status(201).json({ order, receiptPath, email });
});

app.use('/api/*', (_req, res) => {
  res.status(404).json({ message: 'API route not found.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Music Store API running at http://localhost:${port}`);
});
