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

const QUESTDB_URL = 'http://127.0.0.1:9000/exec';
const JWT_SECRET  = 'ktrade_admin_jwt_secret_2026';
const PORT        = 3000;

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

// ─── Market Data ─────────────────────────────────────────────────────────────

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
