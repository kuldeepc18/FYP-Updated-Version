import { useState, useEffect } from "react";
import { getSurveillanceAlerts } from "@/data/apiMarketData";
import { cn } from "@/lib/utils";
import { ScanSearch, AlertTriangle, ShieldAlert, Eye } from "lucide-react";

interface SurveillanceAlert {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  symbol: string;
  description: string;
  detectedAt: string;
  status: 'ACTIVE' | 'RESOLVED' | 'INVESTIGATING';
  assignedTo?: string;
}

export default function Surveillance() {
  const [surveillanceAlerts, setSurveillanceAlerts] = useState<SurveillanceAlert[]>([]);

  useEffect(() => {
    const loadAlerts = async () => {
      try {
        const alerts = await getSurveillanceAlerts();
        setSurveillanceAlerts(alerts);
      } catch (error) {
        console.error('Failed to load surveillance alerts:', error);
      }
    };

    loadAlerts();
    const interval = setInterval(loadAlerts, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, []);
  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return "bg-negative/20 text-negative";
      case "HIGH":
        return "bg-warning/20 text-warning";
      case "MEDIUM":
        return "bg-neutral/20 text-neutral";
      case "LOW":
        return "bg-secondary text-muted-foreground";
      default:
        return "bg-secondary text-muted-foreground";
    }
  };

  const getStatusStyles = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "text-negative";
      case "INVESTIGATING":
        return "text-warning";
      case "RESOLVED":
        return "text-positive";
      default:
        return "text-muted-foreground";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "ANOMALY":
        return <AlertTriangle className="h-4 w-4" />;
      case "MANIPULATION":
        return <ShieldAlert className="h-4 w-4" />;
      case "SUSPICIOUS":
        return <Eye className="h-4 w-4" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const activeAlerts = surveillanceAlerts.filter((a) => a.status === "ACTIVE").length;
  const criticalAlerts = surveillanceAlerts.filter((a) => a.severity === "CRITICAL").length;
  const investigatingAlerts = surveillanceAlerts.filter((a) => a.status === "INVESTIGATING").length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">AI Market Surveillance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Anomaly detection and market manipulation monitoring
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ScanSearch className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-primary">Surveillance Active</span>
        </div>
      </div>

      {/* Alert Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="panel">
          <div className="p-4">
            <p className="data-label">Total Alerts</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{surveillanceAlerts.length}</p>
          </div>
        </div>
        <div className="panel">
          <div className="p-4">
            <p className="data-label">Active</p>
            <p className="text-2xl font-semibold text-negative mt-1">{activeAlerts}</p>
          </div>
        </div>
        <div className="panel">
          <div className="p-4">
            <p className="data-label">Critical</p>
            <p className="text-2xl font-semibold text-warning mt-1">{criticalAlerts}</p>
          </div>
        </div>
        <div className="panel">
          <div className="p-4">
            <p className="data-label">Investigating</p>
            <p className="text-2xl font-semibold text-neutral mt-1">{investigatingAlerts}</p>
          </div>
        </div>
      </div>

      {/* Surveillance Alerts Table */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Detected Alerts</h2>
          <span className="text-xs text-muted-foreground">
            ML-powered detection enabled after model integration
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Symbol</th>
                <th>Description</th>
                <th>Status</th>
                <th className="text-right">Detected At</th>
              </tr>
            </thead>
            <tbody>
              {surveillanceAlerts.map((alert) => (
                <tr
                  key={alert.id}
                  className={cn(
                    alert.status === "ACTIVE" && "bg-negative/5",
                    alert.severity === "CRITICAL" && alert.status === "ACTIVE" && "bg-negative/10"
                  )}
                >
                  <td className="font-mono text-xs text-muted-foreground">{alert.id}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          alert.type === "MANIPULATION" && "text-negative",
                          alert.type === "ANOMALY" && "text-warning",
                          alert.type === "SUSPICIOUS" && "text-neutral"
                        )}
                      >
                        {getTypeIcon(alert.type)}
                      </span>
                      <span className="text-sm font-medium text-foreground">{alert.type}</span>
                    </div>
                  </td>
                  <td>
                    <span className={cn("text-xs font-medium px-2 py-0.5 rounded", getSeverityStyles(alert.severity))}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="font-medium text-foreground">{alert.symbol}</td>
                  <td className="text-sm text-muted-foreground max-w-md truncate">
                    {alert.description}
                  </td>
                  <td>
                    <span className={cn("text-sm font-medium", getStatusStyles(alert.status))}>
                      {alert.status}
                    </span>
                  </td>
                  <td className="text-right font-mono text-xs text-muted-foreground">
                    {formatTime(alert.detectedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detection Types Legend */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Detection Types</h2>
        </div>
        <div className="panel-content grid grid-cols-3 gap-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Anomaly</p>
              <p className="text-sm text-muted-foreground mt-1">
                Unusual patterns in volume, price, or trading activity that deviate from normal
                behavior.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-negative flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Manipulation</p>
              <p className="text-sm text-muted-foreground mt-1">
                Detected patterns matching known manipulation tactics: spoofing, layering, wash
                trading.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Eye className="h-5 w-5 text-neutral flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Suspicious</p>
              <p className="text-sm text-muted-foreground mt-1">
                Activity requiring further investigation. May indicate coordinated behavior or
                unusual patterns.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ML Integration Notice */}
      <div className="flex items-start gap-3 p-4 rounded-md bg-primary/10 border border-primary/20">
        <ScanSearch className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-foreground">ML Model Integration Pending</p>
          <p className="mt-1 text-muted-foreground">
            Full AI-powered surveillance will be enabled after Mahek's ML model integration is
            complete. Current alerts are based on rule-based detection systems.
          </p>
        </div>
      </div>
    </div>
  );
}
