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

// Compute net open positions for a user from their FILLED orders.
// allOrdersOverride: when supplied (e.g. from the in-memory loop array), use
// that instead of re-reading the file — prevents a one-tick stale read that
// caused auto square-offs to fire repeatedly into an infinite chain.
function computeUserPositions(userId, priceMap, allOrdersOverride = null) {
  const orders = (allOrdersOverride !== null ? allOrdersOverride : readUserOrders()).filter(
    o => o.userId === userId &&
         (o.status === 'FILLED' || (o.status === 'PARTIAL' && o.filledQuantity > 0)) &&
         o.filledQuantity > 0
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

// ─── FIFO open-position order resolver ───────────────────────────────────────
//
// Returns the filled orders that constitute the CURRENT (not yet squared-off)
// open position for a user+symbol by FIFO-matching buys against sells.
//
// Why this matters: if a user previously had a position with T/SL (which was
// then exited), and later opens a NEW position for the same symbol without
// setting any T/SL, the old order's T/SL must NOT fire on the new position.
// Using FIFO matching guarantees that only orders whose filled quantity has NOT
// yet been matched by a subsequent opposite-side fill are considered "open".
//
// Returns: { side: 'BUY' | 'SELL' | null, openOrders: Order[] }
//   openOrders — the actual Order objects that still have unmatched open qty.
//   A T/SL should only be sourced from these orders.
function getOpenPositionOrders(userId, symbol, allOrders) {
  // Sort chronologically (oldest first) so FIFO matching is correct.
  const filled = allOrders.filter(
    o => o.userId === userId && o.symbol === symbol &&
         (o.status === 'FILLED' || (o.status === 'PARTIAL' && o.filledQuantity > 0)) &&
         o.filledQuantity > 0
  ).sort((a, b) => (a.fillTimestamp || a.timestamp) - (b.fillTimestamp || b.timestamp));

  const openBuys  = []; // [{ order, remainingQty }]
  const openSells = []; // [{ order, remainingQty }]

  for (const o of filled) {
    let rem = o.filledQuantity;
    if (o.side === 'BUY') {
      // A buy first closes any existing short, then opens a long.
      while (rem > 0.0001 && openSells.length > 0) {
        const oldest  = openSells[0];
        const matched = Math.min(oldest.remainingQty, rem);
        oldest.remainingQty -= matched;
        rem -= matched;
        if (oldest.remainingQty <= 0.0001) openSells.shift();
      }
      if (rem > 0.0001) openBuys.push({ order: o, remainingQty: rem });
    } else {
      // A sell first closes any existing long, then opens a short.
      while (rem > 0.0001 && openBuys.length > 0) {
        const oldest  = openBuys[0];
        const matched = Math.min(oldest.remainingQty, rem);
        oldest.remainingQty -= matched;
        rem -= matched;
        if (oldest.remainingQty <= 0.0001) openBuys.shift();
      }
      if (rem > 0.0001) openSells.push({ order: o, remainingQty: rem });
    }
  }

  if (openBuys.length  > 0) return { side: 'BUY',  openOrders: openBuys.map(e  => e.order) };
  if (openSells.length > 0) return { side: 'SELL', openOrders: openSells.map(e => e.order) };
  return { side: null, openOrders: [] };
}

// ── Partial-fill helpers ──────────────────────────────────────────────────────
//
// requiresPartialFill — returns true when this order's total quantity is large
// enough (relative to the instrument's LTP) that it should be executed gradually
// over several 1-second matching-loop ticks, simulating real market liquidity.
//
// Threshold matrix:
//   LTP < 1 000             →  partial when qty ≥ 1 000
//   1 000 ≤ LTP ≤ 10 000   →  partial when qty ≥ 1 000
//   10 000 < LTP ≤ 20 000  →  partial when qty ≥   500
//   LTP > 20 000            →  partial when qty ≥   100
function requiresPartialFill(orderQty, ltp) {
  if (ltp > 20000) return orderQty >= 100;
  if (ltp > 10000) return orderQty >= 500;   // DIXON range: 10 000 < ltp ≤ 20 000
  return orderQty >= 1000;                   // covers both < 1 000 and 1 000–10 000
}

// partialChunkQty — fills 5–20 % of remaining quantity per loop tick so that
// large orders complete in roughly 5–30 seconds, mimicking real market absorption.
function partialChunkQty(remainingQty) {
  const pct = 0.05 + Math.random() * 0.15;  // 5 %–20 % per tick
  return Math.max(1, Math.min(remainingQty, Math.floor(remainingQty * pct)));
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

const INSTRUMENT_BY_SYMBOL = Object.values(INSTRUMENTS).reduce((acc, inst) => {
  acc[inst.symbol] = inst;
  return acc;
}, {});

const PRESSURE_PRICE_STATE = new Map();
const SESSION_OPEN_PRICE_STATE = new Map();
const MARKET_SESSION_STARTED_AT = new Date().toISOString();

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computePendingOrderPressureShift(quotesBySymbol) {
  const pending = readUserOrders().filter((order) =>
    (order.status === 'PENDING' || order.status === 'PARTIAL') &&
    Number(order.quantity || 0) > Number(order.filledQuantity || 0) &&
    Number.isFinite(Number(order.price)) &&
    Number(order.price) > 0
  );

  const pressureMap = {};
  pending.forEach((order) => {
    const symbolQuote = quotesBySymbol[order.symbol];
    const ltp = Number(symbolQuote?.last_price || symbolQuote?.marketPrice || 0);
    if (!ltp || ltp <= 0) return;

    const remainingQty = Math.max(0, Number(order.quantity || 0) - Number(order.filledQuantity || 0));
    if (remainingQty <= 0) return;

    const distancePct = Math.abs(Number(order.price) - ltp) / ltp;
    const proximityWeight = 1 / (1 + distancePct * 40);
    const weightedQty = remainingQty * proximityWeight;

    if (!pressureMap[order.symbol]) pressureMap[order.symbol] = { buy: 0, sell: 0 };
    if (order.side === 'BUY') pressureMap[order.symbol].buy += weightedQty;
    if (order.side === 'SELL') pressureMap[order.symbol].sell += weightedQty;
  });

  const shiftBySymbol = {};
  Object.entries(pressureMap).forEach(([symbol, p]) => {
    const total = p.buy + p.sell;
    if (total <= 0) {
      shiftBySymbol[symbol] = 0;
      return;
    }
    const imbalance = (p.buy - p.sell) / total;
    const participation = clampNumber(Math.log10(1 + total) / 4, 0, 1);
    const targetShift = imbalance * participation * 0.12;
    shiftBySymbol[symbol] = clampNumber(targetShift, -0.18, 0.18);
  });

  return shiftBySymbol;
}

// ─── Market Phase Helper ─────────────────────────────────────────────────────
// Returns current Indian market phase based on IST time.
function getMarketPhase() {
  const nowIST  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const minOfDay = nowIST.getHours() * 60 + nowIST.getMinutes();
  if (minOfDay >= 9 * 60 && minOfDay < 9 * 60 + 15)   return 'PRE_OPEN';
  if (minOfDay >= 9 * 60 + 15 && minOfDay < 15 * 60 + 30) return 'OPEN';
  if (minOfDay >= 15 * 60 + 30 && minOfDay < 16 * 60)  return 'AFTER_MARKET';
  return 'CLOSED';
}

// ─── Device Hash Helper ──────────────────────────────────────────────────────
// Produces a stable, per-user device_id_hash using FNV-1a (identical algorithm
// to the C++ engine's computeDeviceIdHash in Order.hpp). Same user → same hash.
// Output: 8 uppercase hex chars (e.g. "A3F2B1C0") — matches mock-trader format.
function getUserDeviceHash(userId) {
  let hash = 2166136261; // FNV-1a 32-bit offset basis
  const str = String(userId);
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0; // FNV prime, unsigned 32-bit
  }
  return ('00000000' + hash.toString(16).toUpperCase()).slice(-8);
}

// Generate user order ID matching the C++ engine format:
//   instrumentId-random10digits-userId
// split_part(order_id, '-', 1) returns instrumentId — backward-compatible with
// all existing QuestDB queries that rely on this positional split.
function generateUserOrderId(instrumentId, userId) {
  const rand10 = String(Math.floor(1000000000 + Math.random() * 9000000000));
  return `${instrumentId}-${rand10}-${userId}`;
}

// Generate trade ID matching the C++ Trade.hpp format: TRD-instrId-rand10
function generateTradeId(instrumentId) {
  const rand10 = String(Math.floor(1000000000 + Math.random() * 9000000000));
  return `TRD-${instrumentId}-${rand10}`;
}

// Returns a random mock trader ID (1–9 999) as the simulated counterparty for
// paper-trade fills.  In real markets this would be the resting order's owner.
function pickMockCounterparty() {
  return String(Math.floor(1 + Math.random() * 9999));
}

// ─── QuestDB ILP writer — persists a single user order event ─────────────────
//
// Uses QuestDB's InfluxDB Line Protocol HTTP endpoint (port 9000 /write).
//
// Tag columns  (SYMBOL, indexed): order_id, instrument_id, order_type, side,
//   order_status_event, user_id, trade_id, buyer_user_id, seller_user_id,
//   aggressor_side, market_phase, device_id_hash
// Field columns: price (DOUBLE), quantity (LONG), filled_quantity (LONG),
//   remaining_quantity (LONG), is_short_sell (BOOLEAN),
//   order_submit_timestamp (LONG), order_cancel_timestamp (LONG)
//
// statusEvent: 'ORDER_NEW' | 'ORDER_PARTIAL' | 'ORDER_FILLED' |
//              'ORDER_CANCELLED' | 'ORDER_EXPIRED'
//
// order_id format: {instrument_id}-{sanitised-uuid}
//   → split_part(order_id,'-',1) yields instrument_id (compatible with all
//     existing QuestDB queries, which expect this layout from the C++ engine).
//
async function writeUserTradeToQuestDB(order, fillPrice, filledQty, statusEvent, opts = {}) {
  try {
    const instEntry    = Object.values(INSTRUMENTS).find(i => i.symbol === order.symbol);
    const instrumentId = instEntry ? instEntry.id : '0';
    const nowMs        = Date.now();
    const tsNs         = BigInt(nowMs) * 1_000_000n; // ms → nanoseconds for ILP

    // order_id: use the order's own ID directly.
    // New format: instrumentId-rand10digits-userId — split_part(order_id,'-',1) = instrumentId. ✓
    const questOrderId  = order.id || `${instrumentId}-${nowMs}-${order.userId}`;

    const deviceIdHash  = getUserDeviceHash(order.userId);
    const marketPhase   = getMarketPhase();

    // Fill / trade context
    // For ORDER_NEW / CANCELLED / EXPIRED (no fill): all NA (no match occurred).
    // For ORDER_PARTIAL / ORDER_FILLED with qty > 0: real trade_id + counterparty IDs,
    // exactly as the C++ engine writes for TRADE_MATCH rows.
    const isFillEvent  = (statusEvent === 'ORDER_PARTIAL' || statusEvent === 'ORDER_FILLED') && filledQty > 0;
    const tradeId      = opts.tradeId      || (isFillEvent ? generateTradeId(instrumentId) : 'NA');
    const counterparty = isFillEvent ? pickMockCounterparty() : 'NA';
    // buyer/seller: the user IS the buyer for BUY orders and IS the seller for SELL orders;
    // the counterparty (a mock trader) is on the opposite side.
    const buyerUserId  = opts.buyerUserId  ||
      (isFillEvent ? (order.side === 'BUY'  ? String(order.userId) : counterparty) : 'NA');
    const sellerUserId = opts.sellerUserId ||
      (isFillEvent ? (order.side === 'SELL' ? String(order.userId) : counterparty) : 'NA');
    const aggressorSide = opts.aggressorSide || (isFillEvent ? order.side : 'NA');

    const remainingQty  = Math.max(0, (order.quantity || 0) - filledQty);
    // Timestamps in MICROSECONDS — matching the C++ engine's convention (Logger.hpp).
    // JavaScript's Date.now() returns milliseconds; multiply × 1 000 to get µs.
    const submitTsUs   = (order.timestamp || nowMs) * 1000;
    const cancelTsUs   = opts.cancelTimestamp ? opts.cancelTimestamp * 1000 : 0;
    const matchTsUs    = nowMs * 1000; // match_engine_timestamp in µs

    // is_short_sell: TRUE for SELL orders that are NOT closing an existing position.
    // Any auto-exit order (T/SL or manual) is always a position close, never a short.
    const isShortSell  = order.side === 'SELL' && !(order.isAutoOrder &&
      (order.autoReason === 'USER_EXIT' || order.autoReason === 'USER_EXIT_ALL' ||
       order.autoReason === 'TARGET'    || order.autoReason === 'SL'));

    // ILP tag values must escape spaces (→ '\ '), commas (→ '\,'), '=' (→ '\=')
    const esc = s => String(s).replace(/,/g, '\\,').replace(/=/g, '\\=').replace(/ /g, '\\ ');

    // Build ILP line:  table,tags fields timestamp_ns
    // trader_type / buyer_trader_type / seller_trader_type = NORMAL for all real users
    // (mock traders have their own type stored in the C++ engine rows).
    const line =
      `trade_logs` +
      `,order_id=${esc(questOrderId)}` +
      `,instrument_id=${esc(instrumentId)}` +
      `,order_type=${esc(order.orderType || 'MARKET')}` +
      `,side=${esc(order.side)}` +
      `,order_status_event=${esc(statusEvent)}` +
      `,user_id=${esc(order.userId)}` +
      `,trade_id=${esc(tradeId)}` +
      `,buyer_user_id=${esc(buyerUserId)}` +
      `,seller_user_id=${esc(sellerUserId)}` +
      `,aggressor_side=${esc(aggressorSide)}` +
      `,market_phase=${esc(marketPhase)}` +
      `,device_id_hash=${esc(deviceIdHash)}` +
      `,trader_type=NORMAL` +
      `,buyer_trader_type=NORMAL` +
      `,seller_trader_type=NORMAL` +
      ` price=${Number(fillPrice)}` +
      `,quantity=${order.quantity || 0}i` +
      `,filled_quantity=${filledQty}i` +
      `,remaining_quantity=${remainingQty}i` +
      `,is_short_sell=${isShortSell}` +
      `,order_submit_timestamp=${submitTsUs}i` +
      `,order_cancel_timestamp=${cancelTsUs}i` +
      `,match_engine_timestamp=${matchTsUs}i` +
      ` ${tsNs}\n`;

    await axios.post(QUESTDB_ILP, line, {
      headers : { 'Content-Type': 'text/plain' },
      timeout : 5000,
    });
    console.log(`[QuestDB ILP] ${statusEvent} user=${order.userId} ${order.side} ${order.quantity}x${order.symbol} @ ${fillPrice}`);
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
      device_id_hash: getUserDeviceHash(String(numericId)),
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
  // ── CRITICAL: only use actual execution events to derive market price.
  // ORDER_NEW / CANCELLED / EXPIRED carry limit prices, not traded prices.
  const [latestStats, stats24h] = await Promise.all([
    questdb(`
      SELECT
        split_part(order_id, '-', 1) AS instrument_id,
        last(price)                  AS last_price,
        max(timestamp)               AS latest_timestamp
      FROM trade_logs
      WHERE order_status_event IN ('TRADE_MATCH', 'ORDER_PARTIAL', 'ORDER_FILLED')
      GROUP BY instrument_id
    `),
    questdb(`
      SELECT
        split_part(order_id, '-', 1)               AS instrument_id,
        max(price)                                 AS high24h,
        min(price)                                 AS low24h,
        sum(coalesce(filled_quantity, quantity))   AS total_volume_qty
      FROM trade_logs
      WHERE timestamp > dateadd('h', -24, now())
        AND order_status_event IN ('TRADE_MATCH', 'ORDER_PARTIAL', 'ORDER_FILLED')
      GROUP BY instrument_id
    `),
  ]);

  const latestMap = {};
  latestStats.forEach(row => { latestMap[row.instrument_id] = row; });

  const stats24hMap = {};
  stats24h.forEach(row => { stats24hMap[row.instrument_id] = row; });

  const quotesBySymbol = {};
  Object.values(INSTRUMENTS).forEach((inst) => {
    const latestRow = latestMap[inst.id];
    const lastPrice = latestRow?.last_price ?? inst.basePrice;
    quotesBySymbol[inst.symbol] = {
      last_price: lastPrice,
    };
  });

  const pendingShiftBySymbol = computePendingOrderPressureShift(quotesBySymbol);

  // ── Circuit-breaker tracking ──────────────────────────────────────────────
  // NSE standard: individual stocks have 20 % daily circuit limits.
  // We use inst.basePrice (last known reference / previous-close equivalent)
  // as the anchor.  If the live LTP has moved ≥ 20 % above that anchor the
  // instrument is flagged UPPER_CIRCUIT; ≥ 20 % below → LOWER_CIRCUIT.
  // Thresholds that match NSE filter bands: 2 %, 5 %, 10 %, 20 %.
  // Here we expose the breach level (2 / 5 / 10 / 20) so the UI can show
  // the tightest applicable circuit that has been hit.
  const CIRCUIT_BANDS = [20, 10, 5, 2]; // highest first so we break on tightest hit

  return Object.values(INSTRUMENTS).map(inst => {
    const latestRow = latestMap[inst.id];
    const row24h = stats24hMap[inst.id];
    const row = quotesBySymbol[inst.symbol];
    const tradeDerivedPrice = row?.last_price ?? inst.basePrice;
    const targetShift = pendingShiftBySymbol[inst.symbol] || 0;
    const previousShift = PRESSURE_PRICE_STATE.get(inst.symbol) || 0;
    const nextShift = Math.abs(previousShift * 0.78 + targetShift * 0.22) < 0.00001
      ? 0
      : (previousShift * 0.78 + targetShift * 0.22);
    PRESSURE_PRICE_STATE.set(inst.symbol, nextShift);

    const lastPrice = Math.max(0.01, tradeDerivedPrice * (1 + nextShift));
    if (!SESSION_OPEN_PRICE_STATE.has(inst.symbol)) {
      SESSION_OPEN_PRICE_STATE.set(inst.symbol, lastPrice);
    }
    const startPrice = SESSION_OPEN_PRICE_STATE.get(inst.symbol) ?? lastPrice;
    const change     = lastPrice - startPrice;
    const changePct  = startPrice ? (change / startPrice) * 100 : 0;

    // Determine circuit status relative to the instrument's reference base price
    const pctFromBase  = inst.basePrice > 0
      ? ((lastPrice - inst.basePrice) / inst.basePrice) * 100
      : 0;
    let circuitStatus  = 'NONE';   // 'UPPER_CIRCUIT' | 'LOWER_CIRCUIT' | 'NONE'
    let circuitBand    = 0;        // 2 | 5 | 10 | 20 — the breached band (0 = none)

    for (const band of CIRCUIT_BANDS) {
      if (pctFromBase >= band) {
        circuitStatus = 'UPPER_CIRCUIT';
        circuitBand   = band;
        break;
      }
      if (pctFromBase <= -band) {
        circuitStatus = 'LOWER_CIRCUIT';
        circuitBand   = band;
        break;
      }
    }

    return {
      id            : inst.id,
      symbol        : inst.symbol,
      name          : inst.name,
      marketPrice   : lastPrice,
      sessionOpenPrice: startPrice,
      change        : change,
      changePercent : changePct,
      high24h       : Math.max(row24h?.high24h ?? lastPrice, lastPrice),
      low24h        : Math.min(row24h?.low24h  ?? lastPrice, lastPrice),
      volume        : row24h?.total_volume_qty ?? 0,
      latestTimestamp: latestRow?.latest_timestamp ?? MARKET_SESSION_STARTED_AT,
      // Circuit breaker fields (used by matching-loop + frontend)
      circuitStatus : circuitStatus,  // 'UPPER_CIRCUIT' | 'LOWER_CIRCUIT' | 'NONE'
      circuitBand   : circuitBand,    // 2 / 5 / 10 / 20 — 0 means no circuit
      basePrice     : inst.basePrice, // reference price used for circuit calc
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
    const combinedBook = await fetchCombinedBook(inst.id);
    const bids = combinedBook.bids;
    const asks = combinedBook.asks;
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
      const combinedBook = await fetchCombinedBook(inst.id);
      const bids = combinedBook.bids;
      const asks = combinedBook.asks;
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

  const user     = findUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const instEntry = Object.values(INSTRUMENTS).find(i => i.symbol === symbol);

  // ── Single live-price fetch shared by (a) BUY balance-hold, (b) placedAtPrice,
  //    and (c) the circuit-breaker check later in this handler.
  let allQuotes    = [];
  let placedAtPrice = null;   // LIVE LTP at the moment of order placement
  try {
    allQuotes     = await fetchMarketQuotes();
    const symQ    = allQuotes.find(q => q.symbol === symbol);
    placedAtPrice = symQ ? symQ.marketPrice : (instEntry ? instEntry.basePrice : null);
  } catch { /* non-critical */ }

  // ── For BUY orders: validate balance and hold funds ──────────────────────
  if (side === 'BUY') {
    // Hold based on the LIMIT price if specified (worst-case cost), otherwise LTP.
    const holdPrice = price ? parseFloat(price) : (placedAtPrice ?? (instEntry ? instEntry.basePrice : null));
    if (!holdPrice) return res.status(400).json({ error: 'Cannot determine price for symbol' });
    const requiredFunds = parseInt(quantity, 10) * holdPrice * 1.002;
    if ((user.balance || 0) < requiredFunds) {
      return res.status(400).json({ error: `Insufficient balance. Required: ₹${requiredFunds.toFixed(2)}, Available: ₹${(user.balance || 0).toFixed(2)}` });
    }
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === userId);
    if (idx !== -1) { users[idx].balance -= requiredFunds; writeUsers(users); }
  }

  const instId = instEntry ? instEntry.id : '0';
  const order = {
    id            : generateUserOrderId(instId, userId),
    instrumentId  : instId,
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
    // LTP captured at the moment this order was placed — used by the matching
    // loop to determine fill direction (must market rise or fall to reach limit?).
    placedAtPrice : placedAtPrice,
    // Pre-computed absolute expiry timestamp (ms).  MARKET orders fill instantly
    // so they carry null.  Non-MARKET orders expire after 120 s (INTRADAY) or
    // 24 h (OVERNIGHT) — whichever comes first relative to this moment.
    expiresAt     : orderType === 'MARKET'
      ? null
      : Date.now() + ((validity || 'INTRADAY') === 'INTRADAY' ? 120_000 : 24 * 60 * 60 * 1000),
  };
  const orders = readUserOrders();
  orders.unshift(order);
  writeUserOrders(orders);

  // Persist ORDER_NEW event to QuestDB trade_logs immediately so the order
  // is visible under the user's history even before it is filled/expired.
  // The limit price is intentionally recorded here for full audit visibility —
  // the LTP contamination that previously caused phantom fills is prevented by
  // the SQL filter in fetchMarketQuotes() which only reads TRADE_MATCH and
  // ORDER_FILLED events for price data.  ORDER_NEW rows are excluded from LTP.
  const auditPrice = price ? parseFloat(price) : (instEntry ? instEntry.basePrice : 0);
  writeUserTradeToQuestDB(order, auditPrice, 0, 'ORDER_NEW').catch(() => {});

  // ── Circuit-breaker check for LIMIT / STOP_LIMIT orders ─────────────────────
  // Reuse allQuotes (already fetched above) — no second network call needed.
  let circuitStatus  = 'NONE';   // 'UPPER_CIRCUIT' | 'LOWER_CIRCUIT' | 'NONE'
  let circuitBand    = 0;        // 2 | 5 | 10 | 20
  let circuitWarning = null;     // human-readable warning string or null

  if (orderType === 'LIMIT' || orderType === 'STOP_LIMIT') {
    const limitPrice = parseFloat(price) || 0;
    const ltp        = placedAtPrice || 0;   // already fetched above

    if (limitPrice > 0 && ltp > 0) {
      const pctDiff = ((limitPrice - ltp) / ltp) * 100;
      const BANDS   = [20, 10, 5, 2];

      for (const band of BANDS) {
        if (pctDiff >= band) {
          circuitStatus  = 'UPPER_CIRCUIT';
          circuitBand    = band;
          circuitWarning = `⚠️ Order price ₹${limitPrice.toFixed(2)} is ${pctDiff.toFixed(1)}% above the current LTP ₹${ltp.toFixed(2)} — this instrument may hit the UPPER CIRCUIT (${band}% band). Your order will remain PENDING until the market gradually reaches ₹${limitPrice.toFixed(2)} or it expires (INTRADAY) / stays overnight (OVERNIGHT).`;
          break;
        }
        if (pctDiff <= -band) {
          circuitStatus  = 'LOWER_CIRCUIT';
          circuitBand    = band;
          circuitWarning = `⚠️ Order price ₹${limitPrice.toFixed(2)} is ${Math.abs(pctDiff).toFixed(1)}% below the current LTP ₹${ltp.toFixed(2)} — this instrument may hit the LOWER CIRCUIT (${band}% band). Your order will remain PENDING until the market gradually reaches ₹${limitPrice.toFixed(2)} or it expires (INTRADAY) / stays overnight (OVERNIGHT).`;
          break;
        }
      }
    }
  }

  res.status(201).json({
    ...order,
    type          : order.orderType,
    circuitStatus,
    circuitBand,
    circuitWarning,
  });
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

  // Persist ORDER_CANCELLED event to QuestDB trade_logs
  writeUserTradeToQuestDB(
    orders[idx],
    orders[idx].price || orders[idx].averagePrice || 0,
    orders[idx].filledQuantity || 0,
    'ORDER_CANCELLED',
    { cancelTimestamp: orders[idx].cancelledAt }
  ).catch(() => {});

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
      expiresAt      : o.expiresAt  || null,
      cancelledAt    : o.cancelledAt || null,
      expiredAt      : o.expiredAt  || null,
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
    const allOrders = readUserOrders();
    const positions = computeUserPositions(userId, priceMap, allOrders);
    // Enrich each position with the active target price and stop loss from the
    // current open orders (same FIFO logic as the matching loop uses for triggers).
    const enriched = positions.map(pos => {
      const { openOrders } = getOpenPositionOrders(userId, pos.symbol, allOrders);
      const nonAutoOpen    = openOrders.filter(o => !o.isAutoOrder);
      const newestFirst    = [...nonAutoOpen].reverse();
      const withTarget     = newestFirst.find(o => o.targetPrice != null && o.targetPrice > 0);
      const withSL         = newestFirst.find(o => o.stopLoss    != null && o.stopLoss    > 0);
      return {
        ...pos,
        targetPrice: withTarget?.targetPrice ?? null,
        stopLoss   : withSL?.stopLoss        ?? null,
      };
    });
    res.json(enriched);
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

    // Guard: reject if an exit auto-order is already pending for this symbol.
    // Without this, a T/SL auto-exit that fired a moment ago (still PENDING)
    // plus a simultaneous manual Exit click would create TWO exit orders and
    // result in an erroneous reverse position (net qty goes negative).
    const allOrders = readUserOrders();
    const hasPendingExit = allOrders.some(
      o => o.userId === userId && o.symbol === symbol &&
           o.isAutoOrder && (o.status === 'PENDING' || o.status === 'PARTIAL')
    );
    if (hasPendingExit) {
      return res.status(409).json({ error: 'An exit order is already pending for this symbol. It will fill within seconds.' });
    }

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
      id            : generateUserOrderId(instEntry ? instEntry.id : '0', userId),
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
    allOrders.unshift(order);
    writeUserOrders(allOrders);
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
    const allOrders = readUserOrders();
    const now = Date.now();
    let exitedCount = 0;
    for (const pos of positions) {
      // Skip symbols that already have a pending exit auto-order — same guard as
      // the single-exit endpoint to prevent creating duplicate exit orders.
      const hasPendingExit = allOrders.some(
        o => o.userId === userId && o.symbol === pos.symbol &&
             o.isAutoOrder && (o.status === 'PENDING' || o.status === 'PARTIAL')
      );
      if (hasPendingExit) continue;

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
      const posInstEntry = Object.values(INSTRUMENTS).find(i => i.symbol === pos.symbol);
      allOrders.unshift({
        id            : generateUserOrderId(posInstEntry ? posInstEntry.id : '0', userId),
        userId,
        symbol        : pos.symbol,
        name          : posInstEntry?.name || pos.name || pos.symbol,
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
      exitedCount++;
    }
    writeUserOrders(allOrders);
    res.json({ ok: true, exited: exitedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/user/orders/:id — update targetPrice and/or stopLoss on a FILLED order
// Note: prefer /api/user/positions/target-sl (below) — it uses FIFO matching to find
// the correct open-position order instead of relying on a specific orderId.
app.patch('/api/user/orders/:id', requireUserAuth, (req, res) => {
  const userId  = req.user.id;
  const orderId = req.params.id;
  const { targetPrice, stopLoss } = req.body;
  const orders = readUserOrders();
  const idx    = orders.findIndex(o => o.id === orderId && o.userId === userId);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });
  if (targetPrice !== undefined) orders[idx].targetPrice = targetPrice != null ? parseFloat(targetPrice) : null;
  if (stopLoss    !== undefined) orders[idx].stopLoss    = stopLoss    != null ? parseFloat(stopLoss)    : null;
  writeUserOrders(orders);
  res.json({ ok: true, order: orders[idx] });
});

// PATCH /api/user/positions/target-sl — set Target Price & Stop Loss on a position.
//
// Uses FIFO matching to identify which filled orders constitute the CURRENT open
// position for this user+symbol.  T/SL is applied to those orders (not an
// arbitrary orderId) so the matching loop's monitoring always reads the correct
// values – preventing both display and auto-trigger failures.
//
// Algorithm:
//   1. Clear T/SL from ALL non-auto filled orders for this symbol (remove stale values
//      that may have been left on previously-squared-off orders).
//   2. Set T/SL on the NEWEST FIFO-open non-auto order so the enrichment query
//      (which searches newest→oldest) finds it immediately.
app.patch('/api/user/positions/target-sl', requireUserAuth, (req, res) => {
  const userId = req.user.id;
  const { symbol, targetPrice, stopLoss } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const orders = readUserOrders();

  // Identify FIFO-open orders for the current position
  const { openOrders } = getOpenPositionOrders(userId, symbol, orders);
  const nonAutoOpen    = openOrders.filter(o => !o.isAutoOrder);

  if (nonAutoOpen.length === 0) {
    return res.status(404).json({ error: 'No open position found for this symbol' });
  }

  // Step 1: clear any stale T/SL from all non-auto filled orders for this symbol.
  orders.forEach(o => {
    if (o.userId === userId && o.symbol === symbol && !o.isAutoOrder && o.status === 'FILLED') {
      o.targetPrice = null;
      o.stopLoss    = null;
    }
  });

  // Step 2: apply the new T/SL to the newest FIFO-open order.
  //   openOrders is sorted oldest→newest (FIFO order), so last element is newest.
  const newestOpen = nonAutoOpen[nonAutoOpen.length - 1];
  const idx = orders.findIndex(o => o.id === newestOpen.id);
  if (idx !== -1) {
    orders[idx].targetPrice = targetPrice != null ? parseFloat(targetPrice) : null;
    orders[idx].stopLoss    = stopLoss    != null ? parseFloat(stopLoss)    : null;
  }

  writeUserOrders(orders);
  res.json({ ok: true });
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
    const quotes = await fetchMarketQuotes();
    const result = quotes.map((q) => ({
      instrument_id    : q.id,
      instrument_name  : q.name,
      symbol           : q.symbol,
      last_price       : q.marketPrice,
      change           : q.change,
      change_percent   : q.changePercent,
      volume_qty       : q.volume,
      high24h          : q.high24h,
      low24h           : q.low24h,
      latest_timestamp : q.latestTimestamp || MARKET_SESSION_STARTED_AT,
    }));

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
        SELECT order_id, price, quantity, filled_quantity, order_status_event
        FROM trade_logs
        WHERE split_part(order_id, '-', 1) = '${instrumentId}'
          AND side = 'BUY'
          AND timestamp > dateadd('s', -15, now())
        LATEST ON timestamp PARTITION BY order_id
      )
      WHERE (order_status_event = 'ORDER_NEW' OR order_status_event = 'ORDER_PARTIAL')
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
        SELECT order_id, price, quantity, filled_quantity, order_status_event
        FROM trade_logs
        WHERE split_part(order_id, '-', 1) = '${instrumentId}'
          AND side = 'SELL'
          AND timestamp > dateadd('s', -15, now())
        LATEST ON timestamp PARTITION BY order_id
      )
      WHERE (order_status_event = 'ORDER_NEW' OR order_status_event = 'ORDER_PARTIAL')
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

function aggregateUserPendingBook(instrumentId, ordersSnapshot = null) {
  const orders = (ordersSnapshot || readUserOrders()).filter((order) => {
    const resolvedInstId = String(
      order.instrumentId || INSTRUMENT_BY_SYMBOL[order.symbol]?.id || ''
    );
    if (resolvedInstId !== String(instrumentId)) return false;
    if (order.status !== 'PENDING' && order.status !== 'PARTIAL') return false;
    const remaining = Math.max(0, (order.quantity || 0) - (order.filledQuantity || 0));
    return remaining > 0 && Number.isFinite(Number(order.price)) && Number(order.price) > 0;
  });

  const bidMap = new Map();
  const askMap = new Map();

  orders.forEach((order) => {
    const price = Number(order.price);
    const remaining = Math.max(0, Number(order.quantity || 0) - Number(order.filledQuantity || 0));
    if (remaining <= 0 || !Number.isFinite(price) || price <= 0) return;

    if (order.side === 'BUY') {
      const existing = bidMap.get(price) || { price, qty_buyers: 0, order_count: 0 };
      existing.qty_buyers += remaining;
      existing.order_count += 1;
      bidMap.set(price, existing);
    } else {
      const existing = askMap.get(price) || { price, qty_sellers: 0, order_count: 0 };
      existing.qty_sellers += remaining;
      existing.order_count += 1;
      askMap.set(price, existing);
    }
  });

  const bids = Array.from(bidMap.values()).sort((a, b) => b.price - a.price);
  const asks = Array.from(askMap.values()).sort((a, b) => a.price - b.price);
  return { bids, asks };
}

function mergeBookLevels(baseLevels, userLevels, side, limit = 5) {
  const mergedMap = new Map();
  const qtyKey = side === 'BUY' ? 'qty_buyers' : 'qty_sellers';

  [...(baseLevels || []), ...(userLevels || [])].forEach((level) => {
    const price = Number(level.price);
    if (!Number.isFinite(price) || price <= 0) return;
    const qty = Number(level[qtyKey] ?? level.quantity ?? 0);
    const orders = Number(level.order_count ?? level.orders ?? 0);
    if (qty <= 0) return;

    const existing = mergedMap.get(price) || { price, [qtyKey]: 0, order_count: 0 };
    existing[qtyKey] += qty;
    existing.order_count += Math.max(orders, 1);
    mergedMap.set(price, existing);
  });

  const levels = Array.from(mergedMap.values());
  levels.sort((a, b) => (side === 'BUY' ? b.price - a.price : a.price - b.price));
  return levels.slice(0, limit);
}

async function fetchCombinedBook(instrumentId, ordersSnapshot = null) {
  let baseBids;
  let baseAsks;
  try {
    const engineBook = await fetchBookFromEngine(instrumentId);
    baseBids = engineBook.bids;
    baseAsks = engineBook.asks;
  } catch {
    const qdbBook = await fetchBookFromQuestDB(instrumentId);
    baseBids = qdbBook.bids;
    baseAsks = qdbBook.asks;
  }

  const userBook = aggregateUserPendingBook(instrumentId, ordersSnapshot);
  return {
    bids: mergeBookLevels(baseBids, userBook.bids, 'BUY', 5),
    asks: mergeBookLevels(baseAsks, userBook.asks, 'SELL', 5),
  };
}

function computeExecutionPriceFromDepth(side, quantity, fallbackPrice, book) {
  const qty = Math.max(1, Number(quantity || 0));
  const defaultPrice = Number(fallbackPrice || 0);
  if (!book || defaultPrice <= 0) return defaultPrice;

  const levels = side === 'BUY' ? (book.asks || []) : (book.bids || []);
  if (!levels.length) return defaultPrice;

  let remaining = qty;
  let consumed = 0;
  let notional = 0;

  for (const level of levels) {
    const levelPrice = Number(level.price || defaultPrice);
    const levelQty = Number(level.qty_buyers ?? level.qty_sellers ?? level.quantity ?? 0);
    if (levelQty <= 0 || levelPrice <= 0) continue;

    const take = Math.min(remaining, levelQty);
    notional += take * levelPrice;
    consumed += take;
    remaining -= take;
    if (remaining <= 0) break;
  }

  if (consumed <= 0) return defaultPrice;
  if (remaining <= 0) return notional / consumed;

  const shortageRatio = remaining / qty;
  const tailPrice = side === 'BUY'
    ? defaultPrice * (1 + 0.002 * shortageRatio)
    : Math.max(0.01, defaultPrice * (1 - 0.002 * shortageRatio));
  return (notional + tailPrice * remaining) / qty;
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
      const combinedBook = await fetchCombinedBook(instrumentId);
      const bids = combinedBook.bids;
      const asks = combinedBook.asks;

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
    const combinedBook = await fetchCombinedBook(instrumentId);
    const bids = combinedBook.bids;
    const asks = combinedBook.asks;
    res.json({ instrument_id: inst.id, instrument_name: inst.name, symbol: inst.symbol, bids, asks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy fallback – no instrument filter
app.get('/api/admin/orders/book', requireAuth, async (_req, res) => {
  try {
    const rows = await questdb(`
      SELECT order_id, order_type, side, price, quantity, order_status_event, filled_quantity, user_id, timestamp
      FROM trade_logs
      WHERE order_status_event = 'ORDER_NEW' OR order_status_event = 'ORDER_PARTIAL'
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
      status   : r.order_status_event,
      timestamp: r.timestamp,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Trade History ────────────────────────────────────────────────────────────

/**
 * GET /api/admin/trades/history
 * All order events, newest first. Uses order_status_event (real QuestDB column).
 * TRADE_MATCH rows are excluded — only order lifecycle events are returned.
 * Query params (all optional):
 *   status        – NEW | PARTIAL | FILLED | CANCELLED | EXPIRED  (maps to ORDER_* in QuestDB)
 *   side          – BUY | SELL
 *   instrument_id – 1..15
 *   limit         – default 1000, max 5000
 */

// Maps frontend status labels → QuestDB order_status_event values
const STATUS_TO_EVENT = {
  NEW       : 'ORDER_NEW',
  PARTIAL   : 'ORDER_PARTIAL',
  FILLED    : 'ORDER_FILLED',
  CANCELLED : 'ORDER_CANCELLED',
  EXPIRED   : 'ORDER_EXPIRED',
};
// Maps QuestDB order_status_event values → frontend status labels
const EVENT_TO_STATUS = Object.fromEntries(
  Object.entries(STATUS_TO_EVENT).map(([k, v]) => [v, k])
);

app.get('/api/admin/trades/history', requireAuth, async (req, res) => {
  try {
    const { status, side, instrument_id, limit } = req.query;
    const maxLimit = Math.min(parseInt(limit, 10) || 1000, 5000);

    // Always exclude internal TRADE_MATCH rows — only show order lifecycle events
    const clauses = [`order_status_event != 'TRADE_MATCH'`];
    const VALID_STATUSES = ['NEW', 'PARTIAL', 'FILLED', 'CANCELLED', 'EXPIRED'];
    const VALID_SIDES    = ['BUY', 'SELL'];

    if (status && VALID_STATUSES.includes(status.toUpperCase())) {
      const evtVal = STATUS_TO_EVENT[status.toUpperCase()];
      clauses.push(`order_status_event = '${evtVal}'`);
    }
    if (side && VALID_SIDES.includes(side.toUpperCase())) {
      clauses.push(`side = '${side.toUpperCase()}'`);
    }
    if (instrument_id) {
      const iid = parseInt(instrument_id, 10);
      if (!isNaN(iid) && INSTRUMENTS[iid]) {
        clauses.push(`instrument_id = '${iid}'`);
      }
    }

    const whereClause = `WHERE ${clauses.join(' AND ')}`;

    const rows = await questdb(`
      SELECT order_id, instrument_id, order_type, side, price, quantity,
             order_status_event, filled_quantity, remaining_quantity,
             user_id, trade_id, buyer_user_id, seller_user_id,
             market_phase, device_id_hash, is_short_sell,
             order_submit_timestamp, order_cancel_timestamp, timestamp
      FROM trade_logs
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ${maxLimit}
    `);

    // ── Historical enrichment for BUY-side order events ─────────────────────
    // Orders written before the C++ trade-context fix have trade_id = 'NA'.
    // For BUY orders we can recover the real trade_id / buyer_user_id /
    // seller_user_id by joining against the TRADE_MATCH row that holds
    // buy_order_id as its order_id.  SELL-side historical rows cannot be
    // enriched this way (no sell_order_id tag in TRADE_MATCH rows).
    const naRows = rows.filter(r => !r.trade_id || r.trade_id === 'NA');
    if (naRows.length > 0) {
      const buyIds = naRows.filter(r => r.side === 'BUY').map(r => `'${r.order_id}'`);
      if (buyIds.length > 0) {
        // QuestDB supports IN() lists; batch in chunks of 250 to stay safe
        const matchMap = {};
        const chunkSize = 250;
        for (let i = 0; i < buyIds.length; i += chunkSize) {
          const chunk = buyIds.slice(i, i + chunkSize).join(',');
          const matchRows = await questdb(`
            SELECT order_id, trade_id, buyer_user_id, seller_user_id
            FROM trade_logs
            WHERE order_status_event = 'TRADE_MATCH'
            AND order_id IN (${chunk})
          `).catch(() => []);
          for (const m of matchRows) {
            if (m.trade_id && m.trade_id !== 'NA') {
              matchMap[m.order_id] = {
                trade_id      : m.trade_id,
                buyer_user_id : m.buyer_user_id,
                seller_user_id: m.seller_user_id,
              };
            }
          }
        }
        // Patch in-memory rows that were enrichable
        for (const r of rows) {
          if ((!r.trade_id || r.trade_id === 'NA') && matchMap[r.order_id]) {
            const m = matchMap[r.order_id];
            r.trade_id       = m.trade_id;
            r.buyer_user_id  = m.buyer_user_id;
            r.seller_user_id = m.seller_user_id;
          }
        }
      }
    }

    res.json(rows.map(r => {
      const iid    = parseInt(r.instrument_id, 10);
      const inst   = INSTRUMENTS[iid] || { id: String(iid), name: String(iid), symbol: String(iid) };
      const status = EVENT_TO_STATUS[r.order_status_event] ?? r.order_status_event ?? '';
      return {
        order_id               : r.order_id,
        instrument_id          : inst.id,
        instrument_name        : inst.name,
        side                   : r.side,
        order_type             : r.order_type,
        price                  : r.price,
        quantity               : r.quantity,
        filled_quantity        : r.filled_quantity,
        remaining_quantity     : r.remaining_quantity,
        total                  : r.price * r.quantity,
        status,
        user_id                : r.user_id,
        trade_id               : r.trade_id       ?? 'NA',
        buyer_user_id          : r.buyer_user_id  ?? 'NA',
        seller_user_id         : r.seller_user_id ?? 'NA',
        market_phase           : r.market_phase           ?? '',
        device_id_hash         : r.device_id_hash         ?? '',
        is_short_sell          : r.is_short_sell          ?? false,
        order_submit_timestamp : r.order_submit_timestamp ?? 0,
        order_cancel_timestamp : r.order_cancel_timestamp ?? 0,
        timestamp              : r.timestamp,
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
    // Exclude TRADE_MATCH rows — count only order lifecycle events
    const [[total], [buyS], [sellS]] = await Promise.all([
      questdb(`SELECT count(*) total_trades, sum(price * quantity) total_volume FROM trade_logs WHERE order_status_event != 'TRADE_MATCH'`),
      questdb(`SELECT sum(price * quantity) buy_volume  FROM trade_logs WHERE order_status_event != 'TRADE_MATCH' AND side = 'BUY'`),
      questdb(`SELECT sum(price * quantity) sell_volume FROM trade_logs WHERE order_status_event != 'TRADE_MATCH' AND side = 'SELL'`),
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
// triggers target/SL auto square-offs, and expires pending non-MARKET orders
// based on their expiresAt field (120 s for INTRADAY, 24 h for OVERNIGHT).
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

    let changed        = false;
    const newAutoOrders = [];
    // Collect events that must be written to QuestDB after file is saved
    const questdbWrites = []; // { order, fillPrice, filledQty, status }

    // Snapshot combined depth per symbol once per loop tick so execution prices
    // reflect current liquidity from mock-trader book + pending user orders.
    const depthBySymbol = {};
    const pendingSymbols = [...new Set(
      orders
        .filter(o => (o.status === 'PENDING' || o.status === 'PARTIAL') && o.symbol)
        .map(o => o.symbol)
    )];
    await Promise.all(pendingSymbols.map(async (symbol) => {
      const instEntry = Object.values(INSTRUMENTS).find(i => i.symbol === symbol);
      if (!instEntry) return;
      try {
        depthBySymbol[symbol] = await fetchCombinedBook(instEntry.id, orders);
      } catch {
        depthBySymbol[symbol] = null;
      }
    }));

    orders.forEach(order => {
      if (order.status !== 'PENDING' && order.status !== 'PARTIAL') return;
      const currentPrice = priceMap[order.symbol];
      if (!currentPrice) return;

      // ── Time-based expiry ──────────────────────────────────────────────────
      //
      // Only non-MARKET orders carry an expiresAt timestamp set at creation:
      //   • INTRADAY LIMIT/STOP/STOP_LIMIT → expiresAt = placedAt + 120 000 ms
      //   • OVERNIGHT LIMIT/STOP/STOP_LIMIT → expiresAt = placedAt + 86 400 000 ms
      //
      // MARKET orders fill within the next loop tick and are never expired here.
      // Orders without expiresAt (e.g. legacy MARKET orders) are skipped.
      if (order.orderType !== 'MARKET' && order.expiresAt != null) {
        const now = Date.now();
        if (now >= order.expiresAt) {
          if (order.filledQuantity > 0) {
            // Partially filled before expiry → treat the filled portion as FILLED
            // and silently expire the remainder, refunding only the unfilled hold.
            const avgFill       = order.averagePrice || order.price || currentPrice;
            order.status        = 'FILLED';
            order.fillTimestamp = now;
            order.fees          = order.filledQuantity * avgFill * 0.001;
            if (order.side === 'BUY') {
              const users = readUsers();
              const idx   = users.findIndex(u => u.id === order.userId);
              if (idx !== -1) {
                const pricePerShare = order.price || order.placedAtPrice || currentPrice;
                const unfilledQty   = order.quantity - order.filledQuantity;
                // Refund held funds for unfilled portion.
                users[idx].balance  = (users[idx].balance || 0) + unfilledQty * pricePerShare * 1.002;
                // Reconcile filled portion: held vs actual.
                const heldForFilled = order.filledQuantity * pricePerShare * 1.002;
                const actualFilled  = order.filledQuantity * avgFill + order.fees;
                users[idx].balance  = (users[idx].balance || 0) + (heldForFilled - actualFilled);
                writeUsers(users);
              }
            }
            const expiryInstEntry  = Object.values(INSTRUMENTS).find(i => i.symbol === order.symbol);
            const expiryInstrId    = expiryInstEntry ? expiryInstEntry.id : '0';
            const expiryTradeId    = generateTradeId(expiryInstrId);
            const expiryCounterpty = pickMockCounterparty();
            const expiryBuyerUid   = order.side === 'BUY'  ? String(order.userId) : expiryCounterpty;
            const expirySellerUid  = order.side === 'SELL' ? String(order.userId) : expiryCounterpty;
            questdbWrites.push({ order: { ...order }, fillPrice: avgFill, filledQty: order.filledQuantity, statusEvent: 'ORDER_FILLED',
              opts: { tradeId: expiryTradeId, buyerUserId: expiryBuyerUid, sellerUserId: expirySellerUid } });
          } else {
            // Never filled → EXPIRED, full refund of held funds.
            order.status    = 'EXPIRED';
            order.expiredAt = now;
            if (order.side === 'BUY') {
              const users = readUsers();
              const idx   = users.findIndex(u => u.id === order.userId);
              if (idx !== -1) { users[idx].balance = (users[idx].balance || 0) + order.quantity * (order.price || currentPrice) * 1.002; writeUsers(users); }
            }
            questdbWrites.push({ order: { ...order }, fillPrice: order.price || currentPrice, filledQty: 0, statusEvent: 'ORDER_EXPIRED', opts: { cancelTimestamp: order.expiredAt } });
          }
          changed = true;
          return;
        }
      }

      // ── Fill conditions ────────────────────────────────────────────────────
      //
      // MARKET orders fill immediately at current LTP.
      //
      // LIMIT orders — directional semantics based on placedAtPrice:
      //
      //   When a limit order is placed, we snapshot the live LTP as
      //   `order.placedAtPrice`.  The market must TRAVEL from that snapshot
      //   to the user's limit price before the order can fill.
      //
      //   BUY LIMIT at X:  (user wants to buy when the market reaches X)
      //     • placed when LTP < X  →  wait for price to RISE  to X  → fill when currentPrice >= X
      //     • placed when LTP > X  →  wait for price to DROP  to X  → fill when currentPrice <= X
      //     • placed when LTP == X →  fill immediately (already at price)
      //
      //   SELL LIMIT at X:  (user wants to sell when the market reaches X)
      //     • placed when LTP > X  →  wait for price to DROP  to X  → fill when currentPrice <= X
      //     • placed when LTP < X  →  wait for price to RISE  to X  → fill when currentPrice >= X
      //     • placed when LTP == X →  fill immediately (already at price)
      //
      //   This guarantees that regardless of how far the limit price is from
      //   the LTP at placement time, the order stays PENDING until the live
      //   market price genuinely moves to (or through) the user's stated price.
      //
      // STOP / STOP_LIMIT orders use conventional trigger semantics:
      //   BUY  STOP: fires when price rises  to stopPrice (breakout buy)
      //   SELL STOP: fires when price falls  to stopPrice (stop-loss sell)
      //
      // NOTE: `currentPrice` comes exclusively from TRADE_MATCH and
      // ORDER_FILLED events in QuestDB — ORDER_NEW rows are excluded from the
      // LTP query so a freshly placed limit order never inflates the LTP and
      // causes a phantom self-fill.
      let shouldFill = false;
      let fillPrice  = currentPrice;

      if (order.orderType === 'MARKET') {
        shouldFill = true;
        fillPrice  = currentPrice;

      } else if (order.orderType === 'LIMIT') {
        const limitPx = Number(order.price || 0);
        if (limitPx > 0) {
          // Realistic limit semantics:
          // BUY  fills when market is AT or BELOW limit price.
          // SELL fills when market is AT or ABOVE limit price.
          if (order.side === 'BUY' && currentPrice <= limitPx) {
            shouldFill = true;
            fillPrice = currentPrice;
          }
          if (order.side === 'SELL' && currentPrice >= limitPx) {
            shouldFill = true;
            fillPrice = currentPrice;
          }
        }

      } else if (order.orderType === 'STOP' || order.orderType === 'STOP_LIMIT') {
        // BUY STOP:  triggers when price rises  to (or through) stopPrice
        // SELL STOP: triggers when price falls  to (or through) stopPrice
        //
        // For STOP orders:        fill at the market price at the moment the stop triggers.
        // For STOP_LIMIT orders:  fill at the user's specified limit price (order.price)
        //   so avg price = the limit price the user specified, not the current market price.
        if (order.side === 'BUY'  && currentPrice >= order.stopPrice) {
          shouldFill = true;
          fillPrice  = (order.orderType === 'STOP_LIMIT' && order.price) ? order.price : currentPrice;
        }
        if (order.side === 'SELL' && currentPrice <= order.stopPrice) {
          shouldFill = true;
          fillPrice  = (order.orderType === 'STOP_LIMIT' && order.price) ? order.price : currentPrice;
        }
      }

      if (shouldFill) {
        // ── Partial vs instant execution ────────────────────────────────────
        //
        // For orders whose total quantity exceeds the instrument's liquidity
        // threshold (based on LTP), fill a fraction this tick and mark PARTIAL.
        // The order re-enters the fill path on every subsequent tick until
        // completely filled, simulating real market absorption.
        //
        // Auto square-off orders (T/SL trigger, user Exit, Exit-All) always fill
        // the FULL remaining quantity in a single tick so the position is closed
        // as quickly as possible — no partial-fill delay for auto exits.
        //
        // avg-price accuracy:
        //   • LIMIT  orders: every chunk fills at `limitPx`  → avg price = limit price ✓
        //   • MARKET orders: every chunk fills at live `currentPrice` at that tick
        //                     → avg price = weighted LTP over fill period ✓
        const remaining    = order.quantity - order.filledQuantity;
        const usePartial   = order.isAutoOrder ? false : requiresPartialFill(order.quantity, fillPrice);
        const chunkQty     = usePartial ? partialChunkQty(remaining) : remaining;
        const isLastChunk  = (order.filledQuantity + chunkQty) >= order.quantity;
        const actualChunk  = isLastChunk ? remaining : chunkQty; // never overfill
        const newFilledQty = order.filledQuantity + actualChunk;

        let execPrice = fillPrice;
        if (order.orderType === 'MARKET' ||
            order.orderType === 'STOP' ||
            order.orderType === 'LIMIT' ||
            order.orderType === 'STOP_LIMIT') {
          execPrice = computeExecutionPriceFromDepth(
            order.side,
            actualChunk,
            currentPrice,
            depthBySymbol[order.symbol]
          );

          if ((order.orderType === 'LIMIT' || order.orderType === 'STOP_LIMIT') && Number(order.price || 0) > 0) {
            const limitPx = Number(order.price);
            execPrice = order.side === 'BUY'
              ? Math.min(execPrice, limitPx)
              : Math.max(execPrice, limitPx);
          }
        }

        // Weighted average price: tracks cumulative fill cost across all chunks.
        const prevAvgPrice = order.averagePrice || 0;
        const newAvgPrice  = order.filledQuantity === 0
          ? execPrice
          : (prevAvgPrice * order.filledQuantity + execPrice * actualChunk) / newFilledQty;

        order.filledQuantity = newFilledQty;
        order.averagePrice   = newAvgPrice;

        if (isLastChunk) {
          // ── Order fully executed ───────────────────────────────────────────
          order.status        = 'FILLED';
          order.fillTimestamp = Date.now();
          order.fees          = newFilledQty * newAvgPrice * 0.001;

          if (order.side === 'SELL') {
            const users = readUsers();
            const idx   = users.findIndex(u => u.id === order.userId);
            if (idx !== -1) {
              // Credit last-chunk proceeds and deduct total fees.
              // Previous partial chunks were already credited per tick.
              users[idx].balance = (users[idx].balance || 0) + actualChunk * execPrice - order.fees;
              writeUsers(users);
            }
          } else {
            // BUY final fill — three cases:
            //   (a) Auto short-cover: per-chunk debits already done; deduct fees only.
            //   (b) Regular BUY (user-placed / USER_EXIT auto): funds held upfront;
            //       reconcile held estimate vs actual weighted cost.
            const users = readUsers();
            const idx   = users.findIndex(u => u.id === order.userId);
            if (idx !== -1) {
              if (order.isAutoOrder && !order.price && order.autoReason !== 'USER_EXIT' && order.autoReason !== 'USER_EXIT_ALL') {
                // Short-cover auto BUY — per-chunk debits done; fees only now
                users[idx].balance = (users[idx].balance || 0) - order.fees;
              } else {
                // Regular BUY: held amount was order.quantity × holdPrice × 1.002
                // (holdPrice = limit price for LIMIT orders, placedAtPrice for MARKET)
                const heldPricePerShare = order.price || order.placedAtPrice || newAvgPrice;
                const held   = order.quantity * heldPricePerShare * 1.002;
                const actual = newFilledQty * newAvgPrice + order.fees;
                users[idx].balance = (users[idx].balance || 0) + (held - actual);
              }
              writeUsers(users);
            }
          }
          // avg price written to QuestDB = final weighted average (accurate execution price).
          // Generate trade ID and counterparty for the final fill — matching C++ engine format.
          const filledInstEntry  = Object.values(INSTRUMENTS).find(i => i.symbol === order.symbol);
          const filledInstrId    = filledInstEntry ? filledInstEntry.id : '0';
          const filledTradeId    = generateTradeId(filledInstrId);
          const filledCounterpty = pickMockCounterparty();
          const filledBuyerUid   = order.side === 'BUY'  ? String(order.userId) : filledCounterpty;
          const filledSellerUid  = order.side === 'SELL' ? String(order.userId) : filledCounterpty;
          questdbWrites.push({ order: { ...order }, fillPrice: newAvgPrice, filledQty: newFilledQty, statusEvent: 'ORDER_FILLED',
            opts: { tradeId: filledTradeId, buyerUserId: filledBuyerUid, sellerUserId: filledSellerUid } });

        } else {
          // ── Partial fill this tick ─────────────────────────────────────────
          order.status = 'PARTIAL';

          if (order.side === 'SELL') {
            // Credit this chunk's proceeds immediately (fees deducted on final fill).
            const users = readUsers();
            const idx   = users.findIndex(u => u.id === order.userId);
            if (idx !== -1) {
              users[idx].balance = (users[idx].balance || 0) + actualChunk * execPrice;
              writeUsers(users);
            }
          } else if (order.isAutoOrder && !order.price && order.autoReason !== 'USER_EXIT' && order.autoReason !== 'USER_EXIT_ALL') {
            // Short-cover auto BUY partial: deduct each chunk cost now (no prior hold).
            const users = readUsers();
            const idx   = users.findIndex(u => u.id === order.userId);
            if (idx !== -1) {
              users[idx].balance = (users[idx].balance || 0) - actualChunk * execPrice;
              writeUsers(users);
            }
          }
          // Regular BUY partial: funds already held at placement — no per-chunk change.

          // Generate trade ID and counterparty for each partial chunk fill.
          const partInstEntry  = Object.values(INSTRUMENTS).find(i => i.symbol === order.symbol);
          const partInstrId    = partInstEntry ? partInstEntry.id : '0';
          const partTradeId    = generateTradeId(partInstrId);
          const partCounterpty = pickMockCounterparty();
          const partBuyerUid   = order.side === 'BUY'  ? String(order.userId) : partCounterpty;
          const partSellerUid  = order.side === 'SELL' ? String(order.userId) : partCounterpty;
          questdbWrites.push({ order: { ...order }, fillPrice: execPrice, filledQty: newFilledQty, statusEvent: 'ORDER_PARTIAL',
            opts: { tradeId: partTradeId, buyerUserId: partBuyerUid, sellerUserId: partSellerUid } });
        }
        changed = true;
      }
    });

    // After all fills: clear targetPrice/stopLoss from orders whose position was
    // fully closed by an auto-exit (T/SL or USER_EXIT) that just filled this tick.
    // This guarantees T/SL values "vanish" exactly when the position they belong to
    // is squared off, preventing any residual stale trigger on a future new position
    // even in edge cases where the FIFO matching might not catch it immediately.
    const autoFilledThisTick = questdbWrites
      .filter(w => w.statusEvent === 'ORDER_FILLED' && w.order.isAutoOrder)
      .map(w => ({ userId: w.order.userId, symbol: w.order.symbol }));
    const clearedKeys = new Set();
    autoFilledThisTick.forEach(({ userId, symbol }) => {
      const key = `${userId}\x00${symbol}`;
      if (clearedKeys.has(key)) return;
      clearedKeys.add(key);
      // Check if the position is fully closed after this auto fill.
      const remaining = computeUserPositions(userId, priceMap, orders);
      const stillOpen = remaining.some(p => p.symbol === symbol && Math.abs(p.quantity) > 0.0001);
      if (!stillOpen) {
        // Position fully closed — clear T/SL from all user-placed filled orders for
        // this symbol so they cannot re-trigger on a future new position.
        orders.forEach(srcOrder => {
          if (srcOrder.userId === userId &&
              srcOrder.symbol === symbol &&
              !srcOrder.isAutoOrder &&
              srcOrder.status === 'FILLED' &&
              (srcOrder.targetPrice != null || srcOrder.stopLoss != null)) {
            srcOrder.targetPrice = null;
            srcOrder.stopLoss    = null;
            changed = true;
          }
        });
      }
    });

    // Target / Stop-Loss monitoring on open positions.
    //
    // *** KEY FIX: pass the in-memory `orders` array to computeUserPositions ***
    //
    // `orders` was already mutated in the fill section above (status set to
    // 'FILLED' in-memory). If we let computeUserPositions re-read from the file
    // it would see a one-tick stale snapshot where the just-filled auto square-off
    // is still PENDING, making the position appear still open, which re-fires the
    // trigger every single tick — creating the endless chain of AUTO orders.
    const usersWithPositions = [...new Set(orders.filter(o => o.status === 'FILLED' || o.status === 'PARTIAL').map(o => o.userId))];
    usersWithPositions.forEach(userId => {
      const positions = computeUserPositions(userId, priceMap, orders);
      positions.forEach(pos => {
        const currentPrice = priceMap[pos.symbol];
        if (!currentPrice) return;

        // FIFO position matching: only use T/SL from orders that are part of
        // the CURRENT open position.
        //
        // CRITICAL FIX: the previous implementation searched ALL non-auto filled
        // orders for the symbol, including orders from positions that were already
        // fully exited.  This caused stale T/SL values from old closed positions
        // to fire spuriously on new positions — even when the user set no T/SL.
        //
        // getOpenPositionOrders() FIFO-matches every buy against every sell in
        // chronological order.  Only orders whose filled quantity has NOT yet been
        // matched by a later opposite-side fill are returned as "open".  T/SL is
        // taken exclusively from those currently-open orders, so once a position
        // is exited, its T/SL values can never affect a subsequent new position.
        const { openOrders } = getOpenPositionOrders(userId, pos.symbol, orders);
        // Only non-auto orders carry user-set T/SL values.
        // Search newest-to-oldest so that when the user edits T/SL via the UI
        // (PATCH on the most-recent order), the updated values take effect
        // immediately — not the older order's stale T/SL.
        const nonAutoOpen = openOrders.filter(o => !o.isAutoOrder);
        // Search newest first for targetPrice, then for stopLoss separately, so
        // they can be patched/set on different orders and still both activate.
        const newestToOldest = [...nonAutoOpen].reverse();
        const withTarget = newestToOldest.find(o => o.targetPrice != null && o.targetPrice > 0);
        const withSL     = newestToOldest.find(o => o.stopLoss    != null && o.stopLoss    > 0);
        if (!withTarget && !withSL) return;

        const effectiveTarget = withTarget?.targetPrice ?? null;
        const effectiveSL     = withSL?.stopLoss       ?? null;

        let trigger = '';
        if (pos.side === 'BUY') {
          // BUY position: profit when price rises above target; loss when falls below SL
          if (effectiveTarget != null && currentPrice >= effectiveTarget) trigger = 'TARGET';
          if (effectiveSL     != null && currentPrice <= effectiveSL)     trigger = 'SL';
        } else {
          // SELL (short) position: profit when price falls below target; loss when rises above SL
          if (effectiveTarget != null && currentPrice <= effectiveTarget) trigger = 'TARGET';
          if (effectiveSL     != null && currentPrice >= effectiveSL)     trigger = 'SL';
        }
        if (!trigger) return;

        // Guard: block only when a PENDING auto order already exists for this
        // user+symbol. FILLED auto orders (from closed previous positions) must
        // NOT block a fresh trigger on a new position on the same instrument.
        const alreadyPendingAuto =
          orders.some(o => o.userId === userId && o.symbol === pos.symbol && o.isAutoOrder && o.status === 'PENDING') ||
          newAutoOrders.some(o => o.userId === userId && o.symbol === pos.symbol && o.isAutoOrder);
        if (alreadyPendingAuto) return;
        const squareOffSide    = pos.side === 'BUY' ? 'SELL' : 'BUY';
        const tslInstEntry     = Object.values(INSTRUMENTS).find(i => i.symbol === pos.symbol);
        newAutoOrders.push({
          id            : generateUserOrderId(tslInstEntry ? tslInstEntry.id : '0', userId),
          instrumentId  : tslInstEntry ? tslInstEntry.id : '0',
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
      questdbWrites.forEach(({ order, fillPrice, filledQty, statusEvent, opts }) => {
        writeUserTradeToQuestDB(order, fillPrice, filledQty, statusEvent, opts || {}).catch(() => {});
      });
    }
  } catch (err) {
    console.error('[MatchingLoop]', err.message);
  }
}

setInterval(runMatchingLoop, 1000);

// ─── One-time startup cleanup: remove garbage auto orders ────────────────────
// The matching-loop bug (stale file read in computeUserPositions) caused an
// endless chain of AUTO BUY/SELL orders to accumulate in user_orders.json.
// This runs once at startup: for each user+symbol, any auto order that fires
// when the net position is already 0 (or goes in the wrong direction) is
// removed, restoring the correct state without touching user-placed orders.
function cleanupGarbageAutoOrders() {
  try {
    const orders = readUserOrders();
    const originalCount = orders.length;

    // Build chronological order per user+symbol from all FILLED orders.
    const filledByKey = {};
    orders.forEach(o => {
      if (o.status !== 'FILLED' || !o.filledQuantity) return;
      const key = `${o.userId}\u0000${o.symbol}`;
      if (!filledByKey[key]) filledByKey[key] = [];
      filledByKey[key].push(o);
    });

    const garbageIds = new Set();

    for (const key of Object.keys(filledByKey)) {
      // Sort chronologically: oldest first
      const filled = filledByKey[key].sort(
        (a, b) => (a.fillTimestamp || a.timestamp || 0) - (b.fillTimestamp || b.timestamp || 0)
      );
      let netQty = 0; // running net position (positive = long, negative = short)

      for (const o of filled) {
        if (o.isAutoOrder) {
          // An auto SELL is only valid when there is an existing net LONG position.
          // An auto BUY  is only valid when there is an existing net SHORT position.
          const isSell = o.side === 'SELL';
          if (isSell && netQty <= 0) { garbageIds.add(o.id); continue; }
          if (!isSell && netQty >= 0) { garbageIds.add(o.id); continue; }
        }
        // Apply this order to the running net (user-placed orders always apply).
        netQty += o.side === 'BUY' ? o.filledQuantity : -o.filledQuantity;
      }
    }

    if (garbageIds.size > 0) {
      writeUserOrders(orders.filter(o => !garbageIds.has(o.id)));
      console.log(`[Startup] Removed ${garbageIds.size} garbage auto orders from user_orders.json (${originalCount} → ${originalCount - garbageIds.size} orders).`);
    } else {
      console.log('[Startup] user_orders.json is clean — no garbage auto orders found.');
    }
  } catch (err) {
    console.error('[Startup Cleanup] Failed:', err.message);
  }
}
cleanupGarbageAutoOrders();

// ─── SSE: Real-time user orders stream ──────────────────────────────────────
// GET /api/user/orders/stream — pushes the authenticated user's full order list
// every 2 s so the frontend can update all tabs without manual polling.
app.get('/api/user/orders/stream', (req, res) => {
  // SSE cannot send custom headers; accept token in ?token= query param OR header
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) { res.status(401).end(); return; }
  let userId;
  try {
    const decoded = jwt.verify(token, USER_JWT_SECRET);
    userId = decoded.id;
  } catch { res.status(401).end(); return; }

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; clearInterval(iv); });

  async function pushOrders() {
    if (closed) return;
    try {
      let quotes = [];
      try { quotes = await fetchMarketQuotes(); } catch {}
      const priceMap = {};
      quotes.forEach(q => { priceMap[q.symbol] = q.marketPrice; });

      const allUserOrders = readUserOrders(); // full list used for position and T/SL enrichment
      const filteredOrders = allUserOrders
        .filter(o => o.userId === userId)
        .map(o => ({
          id            : o.id,
          symbol        : o.symbol,
          name          : o.name,
          side          : o.side,
          type          : o.orderType,
          orderType     : o.orderType,
          quantity      : o.quantity,
          price         : o.price,
          stopPrice     : o.stopPrice,
          targetPrice   : o.targetPrice,
          stopLoss      : o.stopLoss,
          filledQuantity: o.filledQuantity,
          averagePrice  : o.averagePrice,
          status        : o.status,
          validity      : o.validity,
          fees          : o.fees,
          timestamp     : o.timestamp,
          fillTimestamp : o.fillTimestamp,
          cancelledAt   : o.cancelledAt,
          expiredAt     : o.expiredAt,
          isAutoOrder   : o.isAutoOrder,
          autoReason    : o.autoReason,
          expiresAt     : o.expiresAt  || null,
          ltp           : priceMap[o.symbol] || null,
        }));

      const rawPositions = computeUserPositions(userId, priceMap, allUserOrders);
      // Enrich positions with active T/SL values from open orders (same FIFO logic
      // as the matching loop so what's displayed always matches what's monitored).
      const positions = rawPositions.map(pos => {
        const { openOrders } = getOpenPositionOrders(userId, pos.symbol, allUserOrders);
        const nonAutoOpen    = openOrders.filter(o => !o.isAutoOrder);
        const newestFirst    = [...nonAutoOpen].reverse();
        const withTarget     = newestFirst.find(o => o.targetPrice != null && o.targetPrice > 0);
        const withSL         = newestFirst.find(o => o.stopLoss    != null && o.stopLoss    > 0);
        return { ...pos,
          targetPrice: withTarget?.targetPrice ?? null,
          stopLoss   : withSL?.stopLoss        ?? null,
        };
      });

      if (!closed) res.write(`data: ${JSON.stringify({ orders: filteredOrders, positions })}\n\n`);
    } catch (err) {
      if (!closed) res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  }

  pushOrders();
  const iv = setInterval(pushOrders, 2000);
});

// ─── Historical OHLCV endpoint ───────────────────────────────────────────────
// GET /api/market/historical/:instrumentId?interval=1D&limit=90
// Aggregates real trade_logs candles from QuestDB (executed trades only).
app.get('/api/market/historical/:instrumentId', async (req, res) => {
  const inst = resolveInstrument(req.params.instrumentId);
  if (!inst) return res.status(404).json({ error: 'Unknown instrument' });

  const limitRaw   = parseInt(req.query.limit, 10) || 90;
  const limit      = Math.min(limitRaw, 500);
  const interval   = req.query.interval || '1D';

  // Map interval label → QuestDB sample-by unit
  const UNIT_MAP = {
    '1s': '1s', '5s': '5s', '30s': '30s',
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '2h': '2h', '4h': '4h',
    '1D': '1d', '1W': '7d',
  };
  const unit = UNIT_MAP[interval] || '1d';

  try {
    // Try to build real OHLCV from trade_logs for this instrument
    const rows = await questdb(`
      SELECT
        timestamp,
        first(price) AS open,
        max(price)   AS high,
        min(price)   AS low,
        last(price)  AS close,
        sum(coalesce(filled_quantity, quantity)) AS volume
      FROM trade_logs
      WHERE instrument_id = '${inst.id}'
        AND order_status_event IN ('TRADE_MATCH', 'ORDER_PARTIAL', 'ORDER_FILLED')
      SAMPLE BY ${unit}
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `).catch(() => []);

    if (rows.length > 0) {
      const candles = rows
        .reverse()
        .map(r => ({
          time  : new Date(r.timestamp).getTime(),
          open  : r.open,
          high  : r.high,
          low   : r.low,
          close : r.close,
          volume: r.volume || 0,
        }));
      return res.json(candles);
    }

    // No executed-trade history yet.
    return res.json([]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`✅  KTrade Admin API  →  http://localhost:${PORT}/api/admin`);
  console.log(`   QuestDB            →  ${QUESTDB_URL}`);
  console.log(`   Instruments loaded →  ${Object.keys(INSTRUMENTS).length}`);
  console.log(`   SSE stream         →  /api/admin/orders/book/:id/stream`);
  console.log(`   User orders SSE    →  /api/user/orders/stream`);
  console.log(`   Historical OHLCV   →  /api/market/historical/:instrumentId`);
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
