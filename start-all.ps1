# Trading System Startup Script

Write-Host "🚀 Starting Trading System..." -ForegroundColor Green
Write-Host ""

# Start API Server
Write-Host "📡 Starting API Server on port 3000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'c:\Users\Manav Bhatt\Desktop\fyp-along-with-ui\FYP_V01\backend\api-server'; node server.js"
Start-Sleep -Seconds 3

# Start User Trading Frontend
Write-Host "💼 Starting User Trading Frontend on port 8080..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'c:\Users\Manav Bhatt\Desktop\fyp-along-with-ui\FYP_V01\frontend user\ktrade-studio-pro-main'; npm run dev"
Start-Sleep -Seconds 3

# Start Admin Console
Write-Host "🎛️  Starting Admin Console on port 8081..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'c:\Users\Manav Bhatt\Desktop\fyp-along-with-ui\FYP_V01\frontend admin\sentinel-console-main'; npm run dev"

Write-Host ""
Write-Host "✅ All services started!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Access the applications:" -ForegroundColor Yellow
Write-Host "   - API Server:      http://localhost:3000" -ForegroundColor White
Write-Host "   - User Trading:    http://localhost:8080" -ForegroundColor White
Write-Host "   - Admin Console:   http://localhost:8081" -ForegroundColor White
Write-Host ""
Write-Host "🔑 Default Admin Credentials:" -ForegroundColor Yellow
Write-Host "   Email:    admin@sentinel.com" -ForegroundColor White
Write-Host "   Password: admin123" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to exit this window..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
