import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { marketDataService, orderService } from '@/services';
import { useAppSelector } from '@/store/hooks';
import { OHLCV, Trade } from '@/types/trading';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

interface HistoricalDataPanelProps {
  symbol: string;
}

export const HistoricalDataPanel = ({ symbol }: HistoricalDataPanelProps) => {
  const [historicalData, setHistoricalData] = useState<OHLCV[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const { orders } = useAppSelector((state) => state.trading);

  useEffect(() => {
    const loadData = async () => {
      const data = await marketDataService.getOHLCVData(symbol, '1D', Date.now() - 30 * 24 * 60 * 60 * 1000, Date.now());
      setHistoricalData(data.reverse());
      
      const allTrades = await orderService.getTrades();
      setTrades(allTrades.filter(t => t.symbol === symbol));
    };
    loadData();
  }, [symbol]);

  const filledOrders = orders.filter(o => o.status === 'FILLED' && o.symbol === symbol);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatDateTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const exportToCSV = () => {
    const headers = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume'];
    const rows = historicalData.map(d => [
      formatDate(d.time),
      d.open.toFixed(2),
      d.high.toFixed(2),
      d.low.toFixed(2),
      d.close.toFixed(2),
      d.volume.toString()
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbol}_history.csv`;
    a.click();
    toast.success('CSV downloaded');
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="market" className="h-full flex flex-col">
        <div className="flex items-center justify-between border-b bg-muted/20 px-3">
          <TabsList className="rounded-none bg-transparent h-11 p-0 gap-4">
            <TabsTrigger 
              value="market" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 text-sm"
            >
              Price History
            </TabsTrigger>
            <TabsTrigger 
              value="trades" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 text-sm"
            >
              My Trades ({trades.length})
            </TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" className="h-8" onClick={exportToCSV}>
            <Download className="w-4 h-4 mr-1" />
            CSV
          </Button>
        </div>

        <TabsContent value="market" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b">
                <tr>
                  <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Open</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">High</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Low</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Close</th>
                  <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Vol</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {historicalData.map((candle, idx) => {
                  const isGreen = candle.close >= candle.open;
                  return (
                    <tr key={idx} className="hover:bg-muted/30">
                      <td className="py-2.5 px-3 text-muted-foreground">{formatDate(candle.time)}</td>
                      <td className="text-right py-2.5 px-3">₹{candle.open.toFixed(2)}</td>
                      <td className="text-right py-2.5 px-3 text-success">₹{candle.high.toFixed(2)}</td>
                      <td className="text-right py-2.5 px-3 text-destructive">₹{candle.low.toFixed(2)}</td>
                      <td className={`text-right py-2.5 px-3 font-medium ${isGreen ? 'text-success' : 'text-destructive'}`}>
                        ₹{candle.close.toFixed(2)}
                      </td>
                      <td className="text-right py-2.5 px-3 text-muted-foreground">
                        {(candle.volume / 1000).toFixed(0)}K
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="trades" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full">
            {trades.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                <p className="text-sm">No trades for {symbol}</p>
                <p className="text-xs mt-1">Place an order to start trading</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Side</th>
                    <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Qty</th>
                    <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Price</th>
                    <th className="text-right py-2.5 px-3 font-medium text-muted-foreground">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {trades.map((trade) => (
                    <tr key={trade.id} className="hover:bg-muted/30">
                      <td className="py-2.5 px-3 text-muted-foreground">{formatDateTime(trade.timestamp)}</td>
                      <td className={`py-2.5 px-3 font-medium ${trade.side === 'BUY' ? 'text-success' : 'text-destructive'}`}>
                        {trade.side}
                      </td>
                      <td className="text-right py-2.5 px-3">{trade.quantity}</td>
                      <td className="text-right py-2.5 px-3">₹{trade.price.toFixed(2)}</td>
                      <td className="text-right py-2.5 px-3 font-medium">
                        ₹{(trade.quantity * trade.price).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};
