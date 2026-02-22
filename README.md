# Trading System

Integrated trading system with C++ matching engine backend and React frontends.

## System Architecture

### Backend
- **C++ Matching Engine**: High-performance order matching engine in `backend/Matching-Engine-Backend/`
- **API Server**: Node.js/Express REST API and WebSocket server in `backend/api-server/`

### Frontends
- **User Trading App**: React trading interface in `frontend user/ktrade-studio-pro-main/`
- **Admin Console**: React admin monitoring interface in `frontend admin/sentinel-console-main/`

## Quick Start

### 1. Start API Server
```bash
cd "backend/api-server"
npm install
npm start
```

### 2. Start User Trading Frontend
```bash
cd "frontend user/ktrade-studio-pro-main"
npm install
npm run dev
```

### 3. Start Admin Console
```bash
cd "frontend admin/sentinel-console-main"
npm install
npm run dev
```

## Default Credentials

### Admin Console
- Email: `admin@sentinel.com`
- Password: `admin123`

### User Trading App
- Register a new account or use the registration endpoint

## Available Instruments

The system includes 15 Indian market instruments:
- RELIANCE, TCS, DIXON, HDFCBANK, TATAMOTORS
- TATAPOWER, ADANIENT, ADANIGREEN, ADANIPOWER, TANLA
- NIFTY50, BANKNIFTY, FINNIFTY, SENSEX, NIFTYNEXT50

## API Endpoints

### User API (`http://localhost:3000/api`)
- `POST /auth/register` - Register new user
- `POST /auth/login` - User login
- `GET /auth/me` - Get current user
- `GET /market/quotes` - Get market quotes
- `GET /market/search` - Search instruments
- `GET /market/orderbook/:symbol` - Get order book
- `POST /orders` - Place order
- `GET /orders` - Get user orders
- `DELETE /orders/:id` - Cancel order
- `GET /portfolio/holdings` - Get holdings
- `GET /portfolio/positions` - Get positions

### Admin API (`http://localhost:3000/api/admin`)
- `POST /auth/login` - Admin login
- `GET /market/data` - Market overview
- `GET /market/symbols` - All symbols
- `GET /orders/book` - Order book
- `GET /orders/history` - Order history
- `GET /trades/history` - Trade history
- `GET /trades/stats` - Trade statistics
- `GET /ml/predictions` - ML predictions
- `GET /surveillance/alerts` - Surveillance alerts

## WebSocket

Real-time market data updates: `ws://localhost:3000`

## Technology Stack

- **Backend**: C++17, Node.js, Express, WebSocket
- **Frontend**: React, TypeScript, Vite, TailwindCSS, shadcn/ui
- **State Management**: Redux Toolkit
- **Authentication**: JWT
