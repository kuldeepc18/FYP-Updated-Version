import { mlModelStatus } from "@/data/mockMarketData";
import { cn } from "@/lib/utils";
import { Database, Cpu, CheckCircle2, Clock, AlertCircle } from "lucide-react";

export default function MLModel() {
  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-US").format(num);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">ML Model Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Machine learning model preparation, training, and evaluation
          </p>
        </div>
      </div>

      {/* Model Status Overview */}
      <div className="grid grid-cols-3 gap-4">
        <div className="panel col-span-2">
          <div className="panel-header">
            <h2 className="panel-title">Current Model Status</h2>
            <span
              className={cn(
                "text-xs font-medium px-2 py-1 rounded",
                mlModelStatus.status === "TRAINING"
                  ? "bg-warning/20 text-warning"
                  : mlModelStatus.status === "READY"
                  ? "bg-positive/20 text-positive"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              {mlModelStatus.status}
            </span>
          </div>
          <div className="panel-content space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Cpu className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">{mlModelStatus.currentModel}</p>
                  <p className="text-sm text-muted-foreground">Active Model Version</p>
                </div>
              </div>
            </div>

            {/* Training Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Training Progress</span>
                <span className="font-mono text-foreground">{mlModelStatus.progress}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${mlModelStatus.progress}%` }}
                />
              </div>
            </div>

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-positive" />
                <div>
                  <p className="data-label">Last Training</p>
                  <p className="text-sm text-foreground">{formatDate(mlModelStatus.lastTraining)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-neutral" />
                <div>
                  <p className="data-label">Next Scheduled</p>
                  <p className="text-sm text-foreground">{formatDate(mlModelStatus.nextScheduled)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Dataset Info */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Dataset</h2>
          </div>
          <div className="panel-content">
            <div className="flex items-center gap-3 mb-4">
              <Database className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-semibold text-foreground">
                  {formatNumber(mlModelStatus.datasetSize)}
                </p>
                <p className="text-sm text-muted-foreground">Records</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Market Data</span>
                <span className="text-foreground">12.4M</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order Book</span>
                <span className="text-foreground">2.8M</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trade Records</span>
                <span className="text-foreground">478K</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Model Metrics */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Model Evaluation Metrics</h2>
        </div>
        <div className="panel-content">
          <div className="grid grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-3xl font-semibold text-positive">{mlModelStatus.accuracy}%</p>
              <p className="data-label mt-2">Accuracy</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-semibold text-neutral">{mlModelStatus.precision}%</p>
              <p className="data-label mt-2">Precision</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-semibold text-neutral">{mlModelStatus.recall}%</p>
              <p className="data-label mt-2">Recall</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-semibold text-primary">{mlModelStatus.f1Score}%</p>
              <p className="data-label mt-2">F1 Score</p>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Stages */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Pipeline Stages</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Description</th>
                <th>Status</th>
                <th className="text-right">Duration</th>
                <th className="text-right">Completed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-medium text-foreground">Data Extraction</td>
                <td className="text-muted-foreground">Pull records from database</td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded bg-positive/20 text-positive">
                    COMPLETE
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">2h 34m</td>
                <td className="text-right font-mono text-xs text-muted-foreground">
                  Jan 5, 12:30
                </td>
              </tr>
              <tr>
                <td className="font-medium text-foreground">Data Preprocessing</td>
                <td className="text-muted-foreground">Clean and normalize data</td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded bg-positive/20 text-positive">
                    COMPLETE
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">1h 12m</td>
                <td className="text-right font-mono text-xs text-muted-foreground">
                  Jan 5, 13:42
                </td>
              </tr>
              <tr>
                <td className="font-medium text-foreground">Feature Engineering</td>
                <td className="text-muted-foreground">Generate training features</td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded bg-positive/20 text-positive">
                    COMPLETE
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">45m</td>
                <td className="text-right font-mono text-xs text-muted-foreground">
                  Jan 5, 14:27
                </td>
              </tr>
              <tr>
                <td className="font-medium text-foreground">Model Training</td>
                <td className="text-muted-foreground">Train neural network</td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded bg-warning/20 text-warning animate-pulse-subtle">
                    IN PROGRESS
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">~4h</td>
                <td className="text-right font-mono text-xs text-muted-foreground">—</td>
              </tr>
              <tr>
                <td className="font-medium text-foreground">Evaluation</td>
                <td className="text-muted-foreground">Validate model performance</td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">
                    PENDING
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">~30m</td>
                <td className="text-right font-mono text-xs text-muted-foreground">—</td>
              </tr>
              <tr>
                <td className="font-medium text-foreground">Deployment</td>
                <td className="text-muted-foreground">Deploy to surveillance system</td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">
                    PENDING
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">~15m</td>
                <td className="text-right font-mono text-xs text-muted-foreground">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Notice */}
      <div className="flex items-start gap-3 p-4 rounded-md bg-secondary/50 border border-border-subtle">
        <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Read-Only Access</p>
          <p className="mt-1">
            Database access is read-only. Data is used exclusively for model preparation and
            evaluation. No modifications or deletions are permitted.
          </p>
        </div>
      </div>
    </div>
  );
}
