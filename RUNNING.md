# Trading System - Quick Start Guide

## 🚀 System is Running!

All three components of the trading system are now running:

### 📡 Backend API Server
- **URL**: http://localhost:3000
- **WebSocket**: ws://localhost:3000
- **Status**: ✅ Running
- Provides REST API and real-time market data updates

### 💼 User Trading Application
- **URL**: http://localhost:8080
- **Status**: ✅ Running
- Full-featured trading interface for end users
- Register a new account to start trading

### 🎛️ Admin Console
- **URL**: http://localhost:8081
- **Status**: ✅ Running
- Administrative monitoring and control interface
- **Login Credentials**:
  - Email: `admin@sentinel.com`
  - Password: `admin123`

## 📊 Available Instruments

The system includes 15 Indian market instruments:
- **Stocks**: RELIANCE, TCS, DIXON, HDFCBANK, TATAMOTORS, TATAPOWER, ADANIENT, ADANIGREEN, ADANIPOWER, TANLA
- **Indices**: NIFTY50, BANKNIFTY, FINNIFTY, SENSEX, NIFTYNEXT50

## 🔧 To Restart in Future

### Option 1: Use Startup Script
```powershell
cd "c:\Users\Admin\Desktop\project"
.\start-all.ps1
```

### Option 2: Manual Start
1. **API Server**:
   ```powershell
   cd "backend/api-server"
   node server.js
   ```

2. **User Frontend**:
   ```powershell
   cd "frontend user/ktrade-studio-pro-main"
   npm run dev
   ```

3. **Admin Console**:
   ```powershell
   cd "frontend admin/sentinel-console-main"
   npm run dev
   ```

## 📝 Features

### User Trading App
- Real-time market data with WebSocket updates
- Place buy/sell orders (Market and Limit)
- View portfolio and positions
- Order management (view, cancel)
- Market search and watchlists

### Admin Console
- Market overview and statistics
- Order book monitoring
- Trade history and analytics
- ML predictions (mock)
- Surveillance alerts (mock)

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│         User Trading App (Port 8080)            │
│         Admin Console (Port 8081)               │
└─────────────────┬───────────────────────────────┘
                  │ HTTP/WebSocket
                  ▼
┌─────────────────────────────────────────────────┐
│      Node.js API Server (Port 3000)             │
│      - REST API                                  │
│      - WebSocket for real-time updates          │
│      - JWT Authentication                        │
└─────────────────────────────────────────────────┘
```

## 🔐 Security Note

The current setup uses mock authentication and in-memory data storage. For production:
- Replace mock auth with proper user management
- Use a real database (PostgreSQL, MongoDB)
- Implement proper security measures
- Change JWT secret key
- Enable HTTPS

## 📚 Next Steps

1. **Register a User Account**: Go to http://localhost:8080 and create an account
2. **Place Your First Order**: Search for an instrument and place a trade
3. **Monitor as Admin**: Login to http://localhost:8081 to see system-wide activity
4. **Explore the API**: Check the README.md for API endpoint documentation

## 🐛 Troubleshooting

If any service fails to start:
1. Check if ports 3000, 8080, 8081 are available
2. Ensure all dependencies are installed (`npm install` in each directory)
3. Check terminal output for specific error messages
4. Restart the service manually using the commands above

## 📖 Documentation

See `README.md` in the project root for complete API documentation and system architecture details.
