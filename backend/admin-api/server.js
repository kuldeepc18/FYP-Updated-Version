/**
 * KTrade Admin API Server  –  v2
 * All data sourced from QuestDB trade_logs. Zero mock data.
 * Port 3000.  Instrument definitions mirror Instrument.hpp exactly.
 */

const express = require('express');
const axios   = require('axios');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const http    = require('http'); // for loopback engine requests
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const QUESTDB_URL    = 'http://127.0.0.1:9000/exec';
const QUESTDB_ILP    = 'http://127.0.0.1:9000/write'; // ILP HTTP ingestion endpoint
const JWT_SECRET     = 'ktrade_admin_jwt_secret_2026';
const USER_JWT_SECRET = 'ktrade_user_jwt_secret_2026';
const PORT           = 3000;

// ─── User data store (file-based, persists across restarts) ──────────────────
const USERS_FILE = path.join(__dirname, 'users.json');

function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function findUserByEmail(email) {
  return readUsers().find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

function findUserById(id) {
  return readUsers().find(u => u.id === id) || null;
}

// ─── User Orders Store (file-based — paper-trading engine) ───────────────────
const USER_ORDERS_FILE = path.join(__dirname, 'user_orders.json');

function readUserOrders() {
  try {
    if (!fs.existsSync(USER_ORDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USER_ORDERS_FILE, 'utf8'));
  } catch { return []; }
}

function writeUserOrders(orders) {
  fs.writeFileSync(USER_ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

// Compute net open positions for a user from their FILLED orders
function computeUserPositions(userId, priceMap) {
  const orders = readUserOrders().filter(
    o => o.userId === userId && o.status === 'FILLED' && o.filledQuantity > 0
  );
  const posMap = {};
  orders.forEach(o => {
    if (!posMap[o.symbol]) posMap[o.symbol] = { symbol: o.symbol, name: o.name, buyQty: 0, sellQty: 0, buyValue: 0, sellValue: 0 };
    if (o.side === 'BUY') {
      posMap[o.symbol].buyQty   += o.filledQuantity;
      posMap[o.symbol].buyValue += o.filledQuantity * (o.averagePrice || o.price || 0);
    } else {
      posMap[o.symbol].sellQty   += o.filledQuantity;
      posMap[o.symbol].sellValue += o.filledQuantity * (o.averagePrice || o.price || 0);
    }
  });
  return Object.values(posMap).map(pos => {
    const netQty = pos.buyQty - pos.sellQty;
    if (Math.abs(netQty) < 0.0001) return null;
    const side      = netQty > 0 ? 'BUY' : 'SELL';
    const absQty    = Math.abs(netQty);
    const avgPrice  = netQty > 0
      ? (pos.buyQty  > 0 ? pos.buyValue  / pos.buyQty  : 0)
      : (pos.sellQty > 0 ? pos.sellValue / pos.sellQty : 0);
    const currentPrice = priceMap[pos.symbol] || avgPrice;
    const unrealizedPnl = netQty > 0
      ? (currentPrice - avgPrice) * absQty
      : (avgPrice - currentPrice) * absQty;
    const unrealizedPnlPercent = avgPrice > 0 ? (unrealizedPnl / (avgPrice * absQty)) * 100 : 0;
    return { symbol: pos.symbol, name: pos.name, quantity: absQty, side, averagePrice: avgPrice, currentPrice, unrealizedPnl, unrealizedPnlPercent, timestamp: Date.now() };
  }).filter(Boolean);
}

const app = express();
app.use(cors());
app.use(express.json());

// ─── Instrument registry (mirrors Instrument.hpp exactly) ────────────────────
const INSTRUMENTS = {
   1: { id: '1',  name: 'Reliance Industries',        symbol: 'RELIANCE (NSE)',    basePrice: 1577.0    },
   2: { id: '2',  name: 'Tata Consultancy Services',  symbol: 'TCS (NSE)',          basePrice: 3213.0    },
   3: { id: '3',  name: 'Dixon Technologies',          symbol: 'DIXON (NSE)',        basePrice: 12055.0   },
   4: { id: '4',  name: 'HDFC Bank',                  symbol: 'HDFCBANK (NSE)',     basePrice: 987.5     },
   5: { id: '5',  name: 'Tata Motors',                symbol: 'TATAMOTORS (NSE)',   basePrice: 373.55    },
   6: { id: '6',  name: 'Tata Power',                 symbol: 'TATAPOWER (NSE)',    basePrice: 388.0     },
   7: { id: '7',  name: 'Adani Enterprises',          symbol: 'ADANIENT (NSE)',     basePrice: 2279.0    },
   8: { id: '8',  name: 'Adani Green Energy',         symbol: 'ADANIGREEN (NSE)',   basePrice: 1028.8    },
   9: { id: '9',  name: 'Adani Power',                symbol: 'ADANIPOWER (NSE)',   basePrice: 146.0     },
  10: { id: '10', name: 'Tanla Platforms',            symbol: 'TANLA (NSE)',        basePrice: 524.0     },
  11: { id: '11', name: 'Nifty 50 Index',             symbol: 'NIFTY 50',          basePrice: 26250.3   },
  12: { id: '12', name: 'Bank Nifty Index',           symbol: 'BANKNIFTY',         basePrice: 60044.2   },
  13: { id: '13', name: 'FinNifty',                   symbol: 'FINNIFTY',          basePrice: 27851.45  },
  14: { id: '14', name: 'Sensex',                     symbol: 'SENSEX',            basePrice: 84961.14  },
  15: { id: '15', name: 'Nifty Next 50 Index',        symbol: 'NIFTY NEXT 50',     basePrice: 70413.4   },
};

// ─── QuestDB ILP writer — persists a single user order event ────────────────
// Uses QuestDB's InfluxDB Line Protocol HTTP endpoint (port 9000 /write).
// Tag columns (SYMBOL): order_id, instrument_id, order_type, side, status, user_id
// Field columns       : price (DOUBLE), quantity (LONG), filled_quantity (LONG)
// order_id format mirrors the C++ engine: {instrument_id}-{timestamp_ms}-{userId}
async function writeUserTradeToQuestDB(order, fillPrice, filledQty, status) {
  try {
    const instEntry    = Object.values(INSTRUMENTS).find(i => i.symbol === order.symbol);
    const instrumentId = instEntry ? instEntry.id : '0';
    const nowMs        = Date.now();
    // Unique order_id: instrument_id-timestamp_ms-userId  (no hyphens inside any part)
    const questOrderId = `${instrumentId}-${nowMs}-${order.userId}`;
    const tsNs         = BigInt(nowMs) * 1_000_000n; // ms → ns for ILP timestamp

    // ILP tag values must escape spaces (→ '\ '), commas (→ '\,'), '=' (→ '\=')
    const esc = s => String(s).replace(/,/g, '\\,').replace(/=/g, '\\=').replace(/ /g, '\\ ');

    // Build line: <table>,<tags> <fields> <timestamp_ns>
    const line =
      `trade_logs` +
      `,order_id=${esc(questOrderId)}` +
      `,instrument_id=${esc(instrumentId)}` +
      `,order_type=${esc(order.orderType || 'MARKET')}` +
      `,side=${esc(order.side)}` +
      `,status=${esc(status)}` +
      `,user_id=${esc(order.userId)}` +
      ` price=${Number(fillPrice)}` +
      `,quantity=${order.quantity}i` +
      `,filled_quantity=${filledQty}i` +
      ` ${tsNs}\n`;

    await axios.post(QUESTDB_ILP, line, {
      headers : { 'Content-Type': 'text/plain' },
      timeout : 5000,
    });
    console.log(`[QuestDB ILP] user_id=${order.userId} ${order.side} ${order.quantity}x${order.symbol} @ ${fillPrice} → ${status}`);
  } catch (err) {
    console.error('[QuestDB ILP] write failed:', err.response?.data || err.message);
  }
}

// ─── QuestDB helper ───────────────────────────────────────────────────────────
async function questdb(sql) {
  try {
    const res = await axios.get(QUESTDB_URL, { params: { query: sql }, timeout: 10000 });
    const { columns, dataset } = res.data;
    if (!dataset) return [];
    return dataset.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col.name] = row[i]; });
      return obj;
    });
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    console.error('[QuestDB]', sql.slice(0, 120), '|', msg);
    throw new Error(msg);
  }
}

// ─── JWT auth middleware ──────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/admin/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const rows = await questdb(
      `SELECT id, email, password_hash, name, role FROM admin_users WHERE email = '${email}' LIMIT 1`
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    if (!await bcrypt.compare(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/auth/logout', requireAuth, (_req, res) => res.json({ ok: true }));

// ─── User Auth Middleware ────────────────────────────────────────────────────
function requireUserAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, USER_JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── User Auth Endpoints ─────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ message: 'email, password and name are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }
  try {
    const existing = findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }
    const password_hash = await bcrypt.hash(password, 12);
    // Assign sequential numeric user IDs starting at 10001
    // (IDs 1–10000 are reserved for mock/system traders)
    const allUsers = readUsers();
    const maxNumericId = allUsers.reduce((max, u) => {
      const n = typeof u.numericId === 'number' ? u.numericId : 0;
      return n > max ? n : max;
    }, 10000);
    const numericId = maxNumericId + 1;
    const newUser = {
      id: String(numericId),
      numericId,
      email: email.toLowerCase().trim(),
      name: name.trim(),
      password_hash,
      balance: 100000,
      total_trades_placed: 0,
      created_at: new Date().toISOString(),
    };
    allUsers.push(newUser);
    writeUsers(allUsers);

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: 'user' },
      USER_JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        numericId: newUser.numericId,
        email: newUser.email,
        name: newUser.name,
        balance: newUser.balance,
      },
    });
  } catch (err) {
    console.error('[User Register]', err.message);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }
  try {
    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: 'user' },
      USER_JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: {
        id: user.id,
        numericId: user.numericId || null,
        email: user.email,
        name: user.name,
        balance: user.balance,
      },
    });
  } catch (err) {
    console.error('[User Login]', err.message);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));

// GET /api/auth/me
app.get('/api/auth/me', requireUserAuth, (req, res) => {
  try {
    const user = findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      id: user.id,
      numericId: user.numericId || null,
      email: user.email,
      name: user.name,
      balance: user.balance,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch user' });
  }
});

// ─── User-facing Market Data (no auth required — public quotes) ──────────────

// Shared helper: fetch latest 24h instrument stats from QuestDB
async function fetchMarketQuotes() {
  const stats = await questdb(`
    SELECT
      split_part(order_id, '-', 1) AS instrument_id,
      first(price)                 AS price_at_start,
      last(price)                  AS last_price,
      max(price)                   AS high24h,
      min(price)                   AS low24h,
      sum(quantity)                AS total_volume_qty
    FROM trade_logs
    WHERE timestamp > dateadd('h', -24, now())
    GROUP BY instrument_id
  `);

  const priceMap = {};
  stats.forEach(row => { priceMap[row.instrument_id] = row; });

  return Object.values(INSTRUMENTS).map(inst => {
    const row       = priceMap[inst.id];
    const lastPrice  = row?.last_price   ?? inst.basePrice;
    const startPrice = row?.price_at_start ?? inst.basePrice;
    const change     = lastPrice - startPrice;
    const changePct  = startPrice ? (change / startPrice) * 100 : 0;
    return {
      id           : inst.id,
      symbol       : inst.symbol,
      name         : inst.name,
      marketPrice  : lastPrice,
      change       : change,
      changePercent: changePct,
      high24h      : row?.high24h ?? lastPrice,
      low24h       : row?.low24h  ?? lastPrice,
      volume       : row?.total_volume_qty ?? 0,
    };
  });
}

// GET /api/market/quotes
app.get('/api/market/quotes', async (_req, res) => {
  try {
    const result = await fetchMarketQuotes();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/market/quotes/stream  — SSE, pushes fresh quotes every 2 s
app.get('/api/market/quotes/stream', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; clearInterval(iv); });

  async function push() {
    if (closed) return;
    try {
      const result = await fetchMarketQuotes();
      if (!closed) res.write(`data: ${JSON.stringify(result)}\n\n`);
    } catch (err) {
      if (!closed) res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  }

  push();
  const iv = setInterval(push, 2000);
});

// ─── User-facing Order Book (no auth required) ───────────────────────────────

function resolveInstrument(raw) {
  const byId = INSTRUMENTS[parseInt(raw, 10)];
  if (byId) return byId;
  const cleaned = raw.replace(/\s/g, '').toLowerCase();
  return Object.values(INSTRUMENTS).find(i =>
    i.symbol.replace(/\s/g, '').toLowerCase() === cleaned || i.id === raw
  ) || null;
}

// GET /api/market/orderbook/:instrumentId
app.get('/api/market/orderbook/:instrumentId', async (req, res) => {
  const inst = resolveInstrument(req.params.instrumentId);
  if (!inst) return res.status(404).json({ error: 'Unknown instrument' });
  try {
    let bids, asks;
    try {
      const eb = await fetchBookFromEngine(inst.id);
      bids = eb.bids; asks = eb.asks;
    } catch {
      const qb = await fetchBookFromQuestDB(inst.id);
      bids = qb.bids; asks = qb.asks;
    }
    res.json({
      symbol: inst.symbol, name: inst.name,
      bids: bids.map(b => ({ price: b.price, quantity: b.qty_buyers  || b.quantity || 0, orders: b.order_count || 1 })),
      asks: asks.map(a => ({ price: a.price, quantity: a.qty_sellers || a.quantity || 0, orders: a.order_count || 1 })),
      lastUpdate: Date.now(),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/market/orderbook/:instrumentId/stream — SSE, no auth
app.get('/api/market/orderbook/:instrumentId/stream', (req, res) => {
  const inst = resolveInstrument(req.params.instrumentId);
  if (!inst) { res.status(404).end(); return; }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  let closed = false;
  req.on('close', () => { closed = true; clearInterval(iv); });
  async function sendBook() {
    if (closed) return;
    try {
      let bids, asks;
      try { const eb = await fetchBookFromEngine(inst.id); bids = eb.bids; asks = eb.asks; }
      catch { const qb = await fetchBookFromQuestDB(inst.id); bids = qb.bids; asks = qb.asks; }
      if (closed) return;
      res.write(`data: ${JSON.stringify({
        symbol: inst.symbol, name: inst.name,
        bids: bids.map(b => ({ price: b.price, quantity: b.qty_buyers  || b.quantity || 0, orders: b.order_count || 1 })),
        asks: asks.map(a => ({ price: a.price, quantity: a.qty_sellers || a.quantity || 0, orders: a.order_count || 1 })),
        lastUpdate: Date.now(),
      })}\n\n`);
    } catch (err) { if (!closed) res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); }
  }
  sendBook();
  const iv = setInterval(sendBook, 400);
});

// ─── User Balance Management ─────────────────────────────────────────────────

// POST /api/user/balance/add
app.post('/api/user/balance/add', requireUserAuth, (req, res) => {
  const amount = parseFloat(req.body?.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'A positive amount is required' });
  }
  try {
    const users = readUsers();
    const idx = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ message: 'User not found' });
    users[idx].balance = (users[idx].balance || 0) + amount;
    writeUsers(users);
    res.json({ balance: users[idx].balance, added: amount });
  } catch (err) {
    console.error('[Balance Add]', err.message);
    res.status(500).json({ message: 'Failed to update balance' });
  }
});

// POST /api/user/balance/withdraw
app.post('/api/user/balance/withdraw', requireUserAuth, (req, res) => {
  const amount = parseFloat(req.body?.amount);
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'A positive amount is required' });
  }
  try {
    const users = readUsers();
    const idx = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ message: 'User not found' });
    const current = users[idx].balance || 0;
    if (amount > current) {
      return res.status(400).json({
        message: `Insufficient balance. Available: ₹${current.toFixed(2)}`,
      });
    }
    users[idx].balance = current - amount;
    writeUsers(users);
    res.json({ balance: users[idx].balance, withdrawn: amount });
  } catch (err) {
    console.error('[Balance Withdraw]', err.message);
    res.status(500).json({ message: 'Failed to update balance' });
  }
});

// ─── User Orders & Positions ─────────────────────────────────────────────────

// POST /api/user/orders — place a new order (paper trading)
app.post('/api/user/orders', requireUserAuth, async (req, res) => {
  const userId = req.user.id;
  const { symbol, side, orderType, validity, quantity, price, stopPrice, targetPrice, stopLoss } = req.body;
  if (!symbol || !side || !orderType || !quantity) return res.status(400).json({ error: 'symbol, side, orderType, quantity required' });
  if (!['BUY','SELL'].includes(side))                          return res.status(400).json({ error: 'side must be BUY or SELL' });
  if (!['MARKET','LIMIT','STOP','STOP_LIMIT'].includes(orderType)) return res.status(400).json({ error: 'Invalid orderType' });
  if (!['INTRADAY','OVERNIGHT'].includes(validity || 'INTRADAY')) return res.status(400).json({ error: 'validity must be INTRADAY or OVERNIGHT' });
  if (parseInt(quantity, 10) <= 0) return res.status(400).json({ error: 'quantity must be positive' });
  const user = findUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const instEntry = Object.values(INSTRUMENTS).find(i => i.symbol === symbol);
  // For BUY orders: validate + hold balance immediately
  if (side === 'BUY') {
    let estPrice = price ? parseFloat(price) : null;
    if (!estPrice) {
      try {
        const quotes = await fetchMarketQuotes();
        const q = quotes.find(q => q.symbol === symbol);
        estPrice = q ? q.marketPrice : (instEntry ? instEntry.basePrice : null);
      } catch {}
    }
    if (!estPrice) return res.status(400).json({ error: 'Cannot determine price for symbol' });
    const requiredFunds = parseInt(quantity, 10) * estPrice * 1.002;
    if ((user.balance || 0) < requiredFunds) {
      return res.status(400).json({ error: `Insufficient balance. Required: \u20b9${requiredFunds.toFixed(2)}, Available: \u20b9${(user.balance || 0).toFixed(2)}` });
    }
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === userId);
    if (idx !== -1) { users[idx].balance -= requiredFunds; writeUsers(users); }
  }
  const order = {
    id            : crypto.randomUUID(),
    userId,
    symbol,
    name          : instEntry?.name || symbol,
    side,
    orderType,
    validity      : validity || 'INTRADAY',
    quantity      : parseInt(quantity, 10),
    price         : price     ? parseFloat(price)      : null,
    stopPrice     : stopPrice ? parseFloat(stopPrice)  : null,
    targetPrice   : targetPrice ? parseFloat(targetPrice) : null,
    stopLoss      : stopLoss  ? parseFloat(stopLoss)   : null,
    status        : 'PENDING',
    filledQuantity: 0,
    averagePrice  : null,
    fees          : 0,
    timestamp     : Date.now(),
    fillTimestamp : null,
    expiredAt     : null,
    isAutoOrder   : false,
  };
  const orders = readUserOrders();
  orders.unshift(order);
  writeUserOrders(orders);
  res.status(201).json({ ...order, type: order.orderType });
});

// DELETE /api/user/orders/:id — cancel a pending order
app.delete('/api/user/orders/:id', requireUserAuth, (req, res) => {
  const userId  = req.user.id;
  const orderId = req.params.id;
  const orders  = readUserOrders();
  const idx     = orders.findIndex(o => o.id === orderId && o.userId === userId);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });
  const order = orders[idx];
  if (order.status !== 'PENDING' && order.status !== 'PARTIAL') return res.status(400).json({ error: 'Only PENDING/PARTIAL orders can be cancelled' });
  // Refund held balance for BUY orders
  if (order.side === 'BUY') {
    const users = readUsers();
    const uidx  = users.findIndex(u => u.id === userId);
    if (uidx !== -1) {
      const refund = order.quantity * (order.price || 0) * 1.002;
      users[uidx].balance = (users[uidx].balance || 0) + refund;
      writeUsers(users);
    }
  }
  orders[idx].status      = 'CANCELLED';
  orders[idx].cancelledAt = Date.now();
  writeUserOrders(orders);
  res.json({ ok: true, id: orderId });
});

// GET /api/user/orders — file-based, all orders for authenticated user
app.get('/api/user/orders', requireUserAuth, (req, res) => {
  const userId = req.user.id;
  const orders = readUserOrders()
    .filter(o => o.userId === userId)
    .map(o => ({
      id             : o.id,
      symbol         : o.symbol,
      name           : o.name,
      side           : o.side,
      type           : o.orderType,
      orderType      : o.orderType,
      quantity       : o.quantity,
      price          : o.price,
      stopPrice      : o.stopPrice,
      targetPrice    : o.targetPrice,
      stopLoss       : o.stopLoss,
      filledQuantity : o.filledQuantity,
      averagePrice   : o.averagePrice,
      status         : o.status,
      validity       : o.validity,
      fees           : o.fees,
      timestamp      : o.timestamp,
      fillTimestamp  : o.fillTimestamp,
      isAutoOrder    : o.isAutoOrder,
      autoReason     : o.autoReason,
    }));
  res.json(orders);
});

// GET /api/user/mytrades — squared-off round trips with realized P&L
app.get('/api/user/mytrades', requireUserAuth, (req, res) => {
  const userId = req.user.id;
  const filled = readUserOrders().filter(o => o.userId === userId && o.status === 'FILLED' && o.filledQuantity > 0);
  const symMap = {};
  filled.forEach(o => {
    if (!symMap[o.symbol]) symMap[o.symbol] = { name: o.name, buys: [], sells: [] };
    if (o.side === 'BUY') symMap[o.symbol].buys.push(o);
    else symMap[o.symbol].sells.push(o);
  });
  const trades = [];
  Object.entries(symMap).forEach(([symbol, { name, buys, sells }]) => {
    if (!buys.length || !sells.length) return;
    const totalBuyQty  = buys.reduce((s, o)  => s + o.filledQuantity, 0);
    const totalSellQty = sells.reduce((s, o) => s + o.filledQuantity, 0);
    const squaredQty   = Math.min(totalBuyQty, totalSellQty);
    if (squaredQty <= 0) return;
    const avgBuy  = buys.reduce((s, o)  => s + o.averagePrice * o.filledQuantity, 0) / totalBuyQty;
    const avgSell = sells.reduce((s, o) => s + o.averagePrice * o.filledQuantity, 0) / totalSellQty;
    const pnl     = (avgSell - avgBuy) * squaredQty;
    const pnlPct  = avgBuy > 0 ? (pnl / (avgBuy * squaredQty)) * 100 : 0;
    trades.push({ symbol, name, quantity: squaredQty, averagePrice: avgBuy, avgSellPrice: avgSell, pnl, pnlPercent: pnlPct, timestamp: (sells[sells.length - 1].fillTimestamp || Date.now()) });
  });
  res.json(trades.sort((a, b) => b.timestamp - a.timestamp));
});

// GET /api/user/positions — file-based net positions with live prices
app.get('/api/user/positions', requireUserAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    let quotes = [];
    try { quotes = await fetchMarketQuotes(); } catch {}
    const priceMap = {};
    quotes.forEach(q => { priceMap[q.symbol] = q.marketPrice; });
    const positions = computeUserPositions(userId, priceMap);
    res.json(positions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/positions/exit — exit a single position at market price
app.post('/api/user/positions/exit', requireUserAuth, async (req, res) => {
  const userId = req.user.id;
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    let quotes = [];
    try { quotes = await fetchMarketQuotes(); } catch {}
    const priceMap = {};
    quotes.forEach(q => { priceMap[q.symbol] = q.marketPrice; });
    const positions = computeUserPositions(userId, priceMap);
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos) return res.status(404).json({ error: 'No open position for this symbol' });
    const exitSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
    const instEntry = Object.values(INSTRUMENTS).find(i => i.symbol === symbol);
    const currentPrice = priceMap[symbol] || pos.averagePrice;
    // For SELL exit of a BUY position: no upfront balance needed
    // For BUY exit of a SELL position: validate + hold funds
    if (exitSide === 'BUY') {
      const requiredFunds = pos.quantity * currentPrice * 1.002;
      const user = findUserById(userId);
      if (!user || (user.balance || 0) < requiredFunds) {
        return res.status(400).json({ error: `Insufficient balance to close SHORT position` });
      }
      const users = readUsers();
      const uidx  = users.findIndex(u => u.id === userId);
      if (uidx !== -1) { users[uidx].balance -= requiredFunds; writeUsers(users); }
    }
    const order = {
      id            : crypto.randomUUID(),
      userId,
      symbol,
      name          : instEntry?.name || pos.name || symbol,
      side          : exitSide,
      orderType     : 'MARKET',
      validity      : 'INTRADAY',
      quantity      : pos.quantity,
      price         : null,
      stopPrice     : null,
      targetPrice   : null,
      stopLoss      : null,
      status        : 'PENDING',
      filledQuantity: 0,
      averagePrice  : null,
      fees          : 0,
      timestamp     : Date.now(),
      fillTimestamp : null,
      expiredAt     : null,
      isAutoOrder   : true,
      autoReason    : 'USER_EXIT',
    };
    const orders = readUserOrders();
    orders.unshift(order);
    writeUserOrders(orders);
    res.json({ ok: true, orderId: order.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/positions/exit-all — exit all open positions at market
app.post('/api/user/positions/exit-all', requireUserAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    let quotes = [];
    try { quotes = await fetchMarketQuotes(); } catch {}
    const priceMap = {};
    quotes.forEach(q => { priceMap[q.symbol] = q.marketPrice; });
    const positions = computeUserPositions(userId, priceMap);
    if (!positions.length) return res.json({ ok: true, exited: 0 });
    const orders = readUserOrders();
    const now = Date.now();
    for (const pos of positions) {
      const exitSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
      const instEntry = Object.values(INSTRUMENTS).find(i => i.symbol === pos.symbol);
      if (exitSide === 'BUY') {
        const currentPrice = priceMap[pos.symbol] || pos.averagePrice;
        const requiredFunds = pos.quantity * currentPrice * 1.002;
        const users = readUsers();
        const uidx  = users.findIndex(u => u.id === userId);
        if (uidx !== -1 && (users[uidx].balance || 0) >= requiredFunds) {
          users[uidx].balance -= requiredFunds;
          writeUsers(users);
        }
      }
      orders.unshift({
        id            : crypto.randomUUID(),
        userId,
        symbol        : pos.symbol,
        name          : instEntry?.name || pos.name || pos.symbol,
        side          : exitSide,
        orderType     : 'MARKET',
        validity      : 'INTRADAY',
        quantity      : pos.quantity,
        price         : null,
        stopPrice     : null,
        targetPrice   : null,
        stopLoss      : null,
        status        : 'PENDING',
        filledQuantity: 0,
        averagePrice  : null,
        fees          : 0,
        timestamp     : now,
        fillTimestamp : null,
        expiredAt     : null,
        isAutoOrder   : true,
        autoReason    : 'USER_EXIT_ALL',
      });
    }
    writeUserOrders(orders);
    res.json({ ok: true, exited: positions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/user/orders/:id — update targetPrice and/or stopLoss on a FILLED order
app.patch('/api/user/orders/:id', requireUserAuth, (req, res) => {
  const userId  = req.user.id;
  const orderId = req.params.id;
  const { targetPrice, stopLoss } = req.body;
  const orders = readUserOrders();
  const idx    = orders.findIndex(o => o.id === orderId && o.userId === userId);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });
  if (targetPrice !== undefined) orders[idx].targetPrice = targetPrice ? parseFloat(targetPrice) : null;
  if (stopLoss    !== undefined) orders[idx].stopLoss    = stopLoss    ? parseFloat(stopLoss)    : null;
  writeUserOrders(orders);
  res.json({ ok: true, order: orders[idx] });
});

// ─── Market Data (Admin) ─────────────────────────────────────────────────────

/**
 * GET /api/admin/market/symbols
 * Per-instrument 24h stats.
 * instrument_id, instrument_name, last_price, change, change_percent,
 * volume_qty (sum ALL orders placed), high24h, low24h, latest_timestamp
 */
app.get('/api/admin/market/symbols', requireAuth, async (_req, res) => {
  try {
    const stats24h = await questdb(`
      SELECT
        split_part(order_id, '-', 1)   AS instrument_id,
        first(price)                   AS price_at_start,
        last(price)                    AS last_price,
        max(price)                     AS high24h,
        min(price)                     AS low24h,
        sum(quantity)                  AS total_volume_qty,
        max(timestamp)                 AS latest_timestamp
      FROM trade_logs
      WHERE timestamp > dateadd('h', -24, now())
      GROUP BY instrument_id
      ORDER BY instrument_id
    `);

    const result = stats24h.map(row => {
      const instId  = parseInt(row.instrument_id, 10);
      const inst    = INSTRUMENTS[instId];
      if (!inst) return null;

      const lastPrice  = row.last_price     ?? 0;
      const startPrice = row.price_at_start ?? lastPrice;
      const change     = lastPrice - startPrice;
      const changePct  = startPrice ? (change / startPrice) * 100 : 0;

      return {
        instrument_id    : inst.id,
        instrument_name  : inst.name,
        symbol           : inst.symbol,
        last_price       : lastPrice,
        change           : change,
        change_percent   : changePct,
        volume_qty       : row.total_volume_qty ?? 0,
        high24h          : row.high24h       ?? lastPrice,
        low24h           : row.low24h        ?? lastPrice,
        latest_timestamp : row.latest_timestamp,
      };
    }).filter(Boolean);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/market/data – overall aggregate
app.get('/api/admin/market/data', requireAuth, async (_req, res) => {
  try {
    const [s] = await questdb(`
      SELECT count(*) total_orders, sum(price * filled_quantity) total_volume,
             min(price) min_price, max(price) max_price, avg(price) avg_price
      FROM trade_logs
    `);
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Matching-engine in-memory book fetcher (port 9100) ────────────────────────
//
// The C++ matching engine serves its live in-memory order book (exactly the same
// data shown in the terminal table) via a tiny HTTP server on 127.0.0.1:9100.
// This is the PRIMARY source: zero latency, zero approximation.
// admin-api falls back to QuestDB (with a 15-second time window that mirrors
// the engine’s 5-second order expiry) when the engine is not running.
//
function fetchBookFromEngine(instrumentId) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:9100/book/${instrumentId}`,
      { timeout: 400 },
      (res) => {
        let raw = '';
        res.on('data', d => { raw += d; });
        res.on('end',  () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('engine timeout')); });
  });
}

// Build bids/asks from QuestDB using a 15 s time window (mirrors the 5 s in-memory
// expiry of the matching engine with generous slack for logging/network jitter).
async function fetchBookFromQuestDB(instrumentId) {
  const [bids, asks] = await Promise.all([
    questdb(`
      SELECT price,
             sum(quantity - filled_quantity) AS qty_buyers,
             count(1)                        AS order_count
      FROM (
        SELECT order_id, price, quantity, filled_quantity, status
        FROM trade_logs
        WHERE split_part(order_id, '-', 1) = '${instrumentId}'
          AND side = 'BUY'
          AND timestamp > dateadd('s', -15, now())
        LATEST ON timestamp PARTITION BY order_id
      )
      WHERE (status = 'NEW' OR status = 'PARTIAL')
        AND (quantity - filled_quantity) > 0
      GROUP BY price
      ORDER BY price DESC
      LIMIT 5
    `),
    questdb(`
      SELECT price,
             sum(quantity - filled_quantity) AS qty_sellers,
             count(1)                        AS order_count
      FROM (
        SELECT order_id, price, quantity, filled_quantity, status
        FROM trade_logs
        WHERE split_part(order_id, '-', 1) = '${instrumentId}'
          AND side = 'SELL'
          AND timestamp > dateadd('s', -15, now())
        LATEST ON timestamp PARTITION BY order_id
      )
      WHERE (status = 'NEW' OR status = 'PARTIAL')
        AND (quantity - filled_quantity) > 0
      GROUP BY price
      ORDER BY price ASC
      LIMIT 5
    `),
  ]);
  return {
    bids: bids.map(b => ({ price: b.price, qty_buyers:  b.qty_buyers,  order_count: b.order_count })),
    asks: asks.map(a => ({ price: a.price, qty_sellers: a.qty_sellers, order_count: a.order_count })),
  };
}

// ─── Order Book ───────────────────────────────────────────────────────────────

// SSE auth: EventSource cannot set custom headers, so we accept token as ?token=
function sseAuth(req, res, next) {
  const token = req.query.token ||
    (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) { res.status(401).end(); return; }
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).end();
  }
}

/**
 * GET /api/admin/orders/book/:instrumentId/stream
 * Server-Sent Events — pushes a fresh order-book snapshot every 400 ms.
 * Auth token must be supplied as ?token=<jwt>  (EventSource cannot set headers).
 */
app.get('/api/admin/orders/book/:instrumentId/stream', sseAuth, (req, res) => {
  const { instrumentId } = req.params;
  const inst = INSTRUMENTS[parseInt(instrumentId, 10)];
  if (!inst) { res.status(404).end(); return; }

  // SSE response headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // tell nginx not to buffer
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; clearInterval(iv); });

  async function sendBook() {
    if (closed) return;
    try {
      // ── 1. Try the live in-memory book from the matching engine (port 9100)
      //       This is the exact same data source as the terminal table.
      let bids, asks;
      try {
        const engineBook = await fetchBookFromEngine(instrumentId);
        bids = engineBook.bids;
        asks = engineBook.asks;
      } catch {
        // ── 2. Engine offline / not yet started – fall back to QuestDB with a
        //       15-second sliding window (mirrors the engine's 5 s order expiry
        //       and adds slack for logging / network jitter).
        const qdbBook = await fetchBookFromQuestDB(instrumentId);
        bids = qdbBook.bids;
        asks = qdbBook.asks;
      }

      if (closed) return;
      const payload = JSON.stringify({
        instrument_id   : inst.id,
        instrument_name : inst.name,
        symbol          : inst.symbol,
        bids,
        asks,
        server_ts: Date.now(),
      });
      res.write(`data: ${payload}\n\n`);
    } catch (err) {
      if (!closed) res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  }

  sendBook(); // push immediately on connect
  const iv = setInterval(sendBook, 250); // then every 250 ms (~4 fps — real market feel)
});

/**
 * GET /api/admin/orders/book/:instrumentId
 * Returns live BIDs and ASKs for the given instrument (pending orders only).
 */
app.get('/api/admin/orders/book/:instrumentId', requireAuth, async (req, res) => {
  const { instrumentId } = req.params;
  const inst = INSTRUMENTS[parseInt(instrumentId, 10)];
  if (!inst) return res.status(404).json({ error: 'Unknown instrument' });

  try {
    // Try in-memory engine first, fall back to QuestDB
    let bids, asks;
    try {
      const engineBook = await fetchBookFromEngine(instrumentId);
      bids = engineBook.bids;
      asks = engineBook.asks;
    } catch {
      const qdbBook = await fetchBookFromQuestDB(instrumentId);
      bids = qdbBook.bids;
      asks = qdbBook.asks;
    }
    res.json({ instrument_id: inst.id, instrument_name: inst.name, symbol: inst.symbol, bids, asks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy fallback – no instrument filter
app.get('/api/admin/orders/book', requireAuth, async (_req, res) => {
  try {
    const rows = await questdb(`
      SELECT order_id, order_type, side, price, quantity, status, filled_quantity, user_id, timestamp
      FROM trade_logs
      WHERE status = 'NEW' OR status = 'PARTIAL'
      ORDER BY timestamp DESC
      LIMIT 200
    `);
    res.json(rows.map((r, i) => ({
      id       : r.order_id || `ord-${i}`,
      side     : r.side === 'BUY' ? 'BID' : 'ASK',
      price    : r.price,
      quantity : r.quantity - r.filled_quantity,
      total    : r.price * (r.quantity - r.filled_quantity),
      orderType: r.order_type,
      userId   : r.user_id,
      status   : r.status,
      timestamp: r.timestamp,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Trade History ────────────────────────────────────────────────────────────

/**
 * GET /api/admin/trades/history
 * All orders, newest first. instrument_id & instrument_name derived per row.
 * Query params (all optional):
 *   status        – e.g. FILLED, CANCELLED, EXPIRED, NEW, PARTIAL (single value)
 *   side          – BUY | SELL
 *   instrument_id – 1..15
 *   limit         – default 1000, max 5000
 */
app.get('/api/admin/trades/history', requireAuth, async (req, res) => {
  try {
    const { status, side, instrument_id, limit } = req.query;
    const maxLimit  = Math.min(parseInt(limit, 10) || 1000, 5000);

    // Build WHERE clauses
    const clauses = [];
    const VALID_STATUSES  = ['NEW','PARTIAL','FILLED','CANCELLED','EXPIRED'];
    const VALID_SIDES     = ['BUY','SELL'];

    if (status && VALID_STATUSES.includes(status.toUpperCase())) {
      clauses.push(`status = '${status.toUpperCase()}'`);
    }
    if (side && VALID_SIDES.includes(side.toUpperCase())) {
      clauses.push(`side = '${side.toUpperCase()}'`);
    }
    if (instrument_id) {
      const iid = parseInt(instrument_id, 10);
      if (!isNaN(iid) && INSTRUMENTS[iid]) {
        clauses.push(`split_part(order_id, '-', 1) = '${iid}'`);
      }
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await questdb(`
      SELECT order_id, order_type, side, price, quantity, status, filled_quantity, user_id, timestamp
      FROM trade_logs
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ${maxLimit}
    `);

    res.json(rows.map(r => {
      const rawId  = (r.order_id || '').split('-')[0];
      const instId = parseInt(rawId, 10);
      const inst   = INSTRUMENTS[instId] || { id: rawId, name: rawId, symbol: rawId };
      return {
        order_id        : r.order_id,
        instrument_id   : inst.id,
        instrument_name : inst.name,
        side            : r.side,
        order_type      : r.order_type,
        price           : r.price,
        quantity        : r.quantity,
        filled_quantity : r.filled_quantity,
        total           : r.price * r.quantity,
        status          : r.status,
        user_id         : r.user_id,
        timestamp       : r.timestamp,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/trades/stats
 * Aggregate totals: total_trades, total_volume, buy_volume, sell_volume
 */
app.get('/api/admin/trades/stats', requireAuth, async (_req, res) => {
  try {
    const [[total], [buyS], [sellS]] = await Promise.all([
      questdb(`SELECT count(*) total_trades, sum(price * quantity) total_volume FROM trade_logs`),
      questdb(`SELECT sum(price * quantity) buy_volume  FROM trade_logs WHERE side = 'BUY'`),
      questdb(`SELECT sum(price * quantity) sell_volume FROM trade_logs WHERE side = 'SELL'`),
    ]);
    res.json({
      total_trades : total?.total_trades  ?? 0,
      total_volume : total?.total_volume  ?? 0,
      buy_volume   : buyS?.buy_volume     ?? 0,
      sell_volume  : sellS?.sell_volume   ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Instruments dropdown list ────────────────────────────────────────────────
app.get('/api/admin/instruments', requireAuth, (_req, res) => {
  res.json(Object.values(INSTRUMENTS));
});

// ─── Users ────────────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAuth, async (_req, res) => {
  try {
    const rows = await questdb(`SELECT id, email, name, balance, total_trades_placed, created_at FROM users ORDER BY created_at ASC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/admin/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ─── Background Paper-Trading Matching Loop ──────────────────────────────────
// Runs every 1 second. Fills PENDING user orders against live QuestDB prices,
// triggers target/SL auto square-offs, and expires INTRADAY orders at 3:30 PM IST.
// Every state transition (FILLED / CANCELLED / EXPIRED) is written to QuestDB
// trade_logs via ILP so that  SELECT * FROM trade_logs WHERE user_id = '10001'
// returns real user trades alongside mock-trader trades.
async function runMatchingLoop() {
  try {
    const orders = readUserOrders();
    if (!orders.length) return;
    let quotes = [];
    try { quotes = await fetchMarketQuotes(); } catch { return; }
    const priceMap = {};
    quotes.forEach(q => { priceMap[q.symbol] = q.marketPrice; });

    const nowIST       = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const minOfDay     = nowIST.getHours() * 60 + nowIST.getMinutes();
    const pastCutoff   = minOfDay >= 15 * 60 + 30; // 3:30 PM IST

    let changed        = false;
    const newAutoOrders = [];
    // Collect events that must be written to QuestDB after file is saved
    const questdbWrites = []; // { order, fillPrice, filledQty, status }

    orders.forEach(order => {
      if (order.status !== 'PENDING' && order.status !== 'PARTIAL') return;
      const currentPrice = priceMap[order.symbol];
      if (!currentPrice) return;

      // Intraday expiry at 3:30 PM IST — overnight stays PENDING overnight
      if (order.validity === 'INTRADAY' && pastCutoff) {
        order.status    = 'EXPIRED';
        order.expiredAt = Date.now();
        // Refund held balance for BUY
        if (order.side === 'BUY') {
          const users = readUsers();
          const idx   = users.findIndex(u => u.id === order.userId);
          if (idx !== -1) { users[idx].balance = (users[idx].balance || 0) + order.quantity * (order.price || currentPrice) * 1.002; writeUsers(users); }
        }
        questdbWrites.push({ order: { ...order }, fillPrice: order.price || currentPrice, filledQty: 0, status: 'EXPIRED' });
        changed = true;
        return;
      }

      // Fill conditions
      let shouldFill = false;
      let fillPrice  = currentPrice;
      if (order.orderType === 'MARKET') {
        shouldFill = true;
      } else if (order.orderType === 'LIMIT') {
        if (order.side === 'BUY'  && currentPrice <= order.price) { shouldFill = true; fillPrice = order.price; }
        if (order.side === 'SELL' && currentPrice >= order.price) { shouldFill = true; fillPrice = order.price; }
      } else if (order.orderType === 'STOP' || order.orderType === 'STOP_LIMIT') {
        if (order.side === 'BUY'  && currentPrice >= order.stopPrice) { shouldFill = true; }
        if (order.side === 'SELL' && currentPrice <= order.stopPrice) { shouldFill = true; }
      }

      if (shouldFill) {
        order.status         = 'FILLED';
        order.filledQuantity = order.quantity;
        order.averagePrice   = fillPrice;
        order.fillTimestamp  = Date.now();
        order.fees           = order.quantity * fillPrice * 0.001;
        if (order.side === 'SELL') {
          const users = readUsers();
          const idx   = users.findIndex(u => u.id === order.userId);
          if (idx !== -1) {
            users[idx].balance = (users[idx].balance || 0) + order.quantity * fillPrice - order.fees;
            writeUsers(users);
          }
        } else {
          // BUY: adjust for actual fill vs estimated hold
          const users = readUsers();
          const idx   = users.findIndex(u => u.id === order.userId);
          if (idx !== -1) {
            const held   = order.quantity * (order.price || fillPrice) * 1.002;
            const actual = order.quantity * fillPrice + order.fees;
            users[idx].balance = (users[idx].balance || 0) + (held - actual);
            writeUsers(users);
          }
        }
        // Queue write to QuestDB trade_logs so the trade is visible per user_id
        questdbWrites.push({ order: { ...order }, fillPrice, filledQty: order.quantity, status: 'FILLED' });
        changed = true;
      }
    });

    // Target / Stop-Loss monitoring on open positions
    const usersWithPositions = [...new Set(orders.filter(o => o.status === 'FILLED').map(o => o.userId))];
    usersWithPositions.forEach(userId => {
      const positions = computeUserPositions(userId, priceMap);
      positions.forEach(pos => {
        const currentPrice = priceMap[pos.symbol];
        if (!currentPrice) return;
        // Find most recent filled order for this symbol with target/SL set
        const relevantFills = orders.filter(o => o.userId === userId && o.symbol === pos.symbol && o.status === 'FILLED');
        const latest = relevantFills[relevantFills.length - 1];
        if (!latest) return;
        let trigger = '';
        if (pos.side === 'BUY') {
          if (latest.targetPrice && currentPrice >= latest.targetPrice) trigger = 'TARGET';
          if (latest.stopLoss   && currentPrice <= latest.stopLoss)    trigger = 'SL';
        } else {
          if (latest.targetPrice && currentPrice <= latest.targetPrice) trigger = 'TARGET';
          if (latest.stopLoss   && currentPrice >= latest.stopLoss)    trigger = 'SL';
        }
        if (!trigger) return;
        const alreadyPendingAuto = orders.some(
          o => o.userId === userId && o.symbol === pos.symbol && o.isAutoOrder && (o.status === 'PENDING' || o.status === 'FILLED')
        ) || newAutoOrders.some(o => o.userId === userId && o.symbol === pos.symbol && o.isAutoOrder);
        if (alreadyPendingAuto) return;
        const squareOffSide = pos.side === 'BUY' ? 'SELL' : 'BUY';
        newAutoOrders.push({
          id            : `AUTO-${crypto.randomUUID()}`,
          userId,
          symbol        : pos.symbol,
          name          : pos.name,
          side          : squareOffSide,
          orderType     : 'MARKET',
          validity      : 'INTRADAY',
          quantity      : pos.quantity,
          price         : null,
          stopPrice     : null,
          targetPrice   : null,
          stopLoss      : null,
          status        : 'PENDING',
          filledQuantity: 0,
          averagePrice  : null,
          fees          : 0,
          timestamp     : Date.now(),
          fillTimestamp : null,
          expiredAt     : null,
          isAutoOrder   : true,
          autoReason    : trigger,
        });
        changed = true;
      });
    });

    if (newAutoOrders.length) {
      writeUserOrders([...newAutoOrders, ...orders]);
    } else if (changed) {
      writeUserOrders(orders);
    }

    // Write all new events to QuestDB trade_logs (non-blocking — fire-and-forget)
    if (questdbWrites.length) {
      questdbWrites.forEach(({ order, fillPrice, filledQty, status }) => {
        writeUserTradeToQuestDB(order, fillPrice, filledQty, status).catch(() => {});
      });
    }
  } catch (err) {
    console.error('[MatchingLoop]', err.message);
  }
}

setInterval(runMatchingLoop, 1000);

const server = app.listen(PORT, () => {
  console.log(`✅  KTrade Admin API  →  http://localhost:${PORT}/api/admin`);
  console.log(`   QuestDB            →  ${QUESTDB_URL}`);
  console.log(`   Instruments loaded →  ${Object.keys(INSTRUMENTS).length}`);
  console.log(`   SSE stream         →  /api/admin/orders/book/:id/stream`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PORT} is already in use.`);
    console.error(`   Kill the existing process first:`);
    console.error(`     fuser -k ${PORT}/tcp`);
    console.error(`   Then restart:  node server.js\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
