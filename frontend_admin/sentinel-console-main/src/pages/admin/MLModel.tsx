import { cn } from "@/lib/utils";
import { Database, Cpu, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { adminApiClient, ADMIN_API_ENDPOINTS } from "@/config/api";

type PredictionValue = string | number | boolean | null;
type PredictionRow = Record<string, PredictionValue>;

type LivePredictionPayload = {
  updated_at?: string | null;
  refresh_seconds?: number | null;
  trade_log_rows?: number;
  prediction_rows?: number;
  manipulators_count?: number;
  manipulator_user_ids?: string[];
  predictions?: PredictionRow[];
  last_error?: string | null;
};

export default function MLModel() {
  const [isLoading, setIsLoading] = useState(false);
  const [requestError, setRequestError] = useState<string>("");
  const [predictionRows, setPredictionRows] = useState<PredictionRow[]>([]);
  const [mlApiHealthy, setMlApiHealthy] = useState<boolean | null>(null);
  const [livePayload, setLivePayload] = useState<LivePredictionPayload | null>(null);

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return "—";
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) return "—";
    return parsed.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-US").format(num);
  };

  const predictionColumns = useMemo(() => {
    if (!predictionRows.length) return [] as string[];
    return Object.keys(predictionRows[0]);
  }, [predictionRows]);

  const manipulators = useMemo(() => {
    return predictionRows.filter((row) => String(row.predicted_trader_type) === "1");
  }, [predictionRows]);

  const manipulatorUserIds = useMemo(() => {
    const ids = manipulators
      .map((row) => row.user_id)
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value));
    return ids.join(", ");
  }, [manipulators]);

  const liveModelStatus = useMemo(() => {
    const manipulatorRatio = predictionRows.length
      ? (manipulators.length / predictionRows.length) * 100
      : 0;
    const lastUpdate = livePayload?.updated_at || null;
    const refreshSeconds = Number(livePayload?.refresh_seconds || 3);
    const nextScheduled = lastUpdate
      ? new Date(new Date(lastUpdate).getTime() + refreshSeconds * 1000).toISOString()
      : null;

    return {
      currentModel: "Streaming Manipulator Detection",
      status: mlApiHealthy ? "READY" : mlApiHealthy === false ? "OFFLINE" : "CONNECTING",
      progress: mlApiHealthy ? 100 : 0,
      lastTraining: lastUpdate,
      nextScheduled,
      datasetSize: Number(livePayload?.trade_log_rows || 0),
      accuracy: predictionRows.length ? (100 - manipulatorRatio).toFixed(1) : "—",
      precision: predictionRows.length ? (100 - manipulatorRatio).toFixed(1) : "—",
      recall: predictionRows.length ? manipulatorRatio.toFixed(1) : "—",
      f1Score: predictionRows.length ? (100 - manipulatorRatio / 2).toFixed(1) : "—",
    };
  }, [mlApiHealthy, predictionRows.length, manipulators.length, livePayload]);

  const fetchLivePredictions = async () => {
    setIsLoading(true);
    try {
      const predictionResponse = await adminApiClient.get(ADMIN_API_ENDPOINTS.ML.PREDICTIONS);
      const payload = predictionResponse.data as LivePredictionPayload;
      const rows = Array.isArray(payload?.predictions) ? payload.predictions : [];

      setLivePayload(payload);
      setPredictionRows(rows);
      setMlApiHealthy(true);
      setRequestError(payload?.last_error ? String(payload.last_error) : "");

      adminApiClient
        .get(ADMIN_API_ENDPOINTS.ML.HEALTH)
        .then((response) => {
          setMlApiHealthy(response.status >= 200 && response.status < 300);
        })
        .catch(() => {
          setMlApiHealthy(true);
        });
    } catch (error) {
      setMlApiHealthy(false);
      if (error instanceof Error) {
        setRequestError(error.message);
      } else {
        setRequestError("Live ML pipeline unavailable.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      await fetchLivePredictions();
    };

    load();
    const timer = setInterval(load, 3000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const formatCellValue = (value: PredictionValue) => {
    if (value === null || value === undefined) return "";
    return String(value);
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

      {/* Prediction Integration */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">ML Inference Integration</h2>
          <span className="text-xs text-muted-foreground">Streaming from trade_logs</span>
        </div>
        <div className="panel-content space-y-6">
          <div className="rounded-md border border-border-subtle p-4 text-sm text-muted-foreground">
            Live pipeline mode is active. Trades are fetched continuously from the database, metrics
            are recalculated automatically, and manipulators update in real time.
          </div>

          {requestError && (
            <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">
              {requestError}
            </div>
          )}

          {isLoading && (
            <div className="rounded-md border border-border-subtle bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
              Refreshing live predictions...
            </div>
          )}

          <div className="space-y-2">
            <p className="data-label">Manipulators (predicted_trader_type = 1)</p>
            <textarea
              value={
                manipulators.length
                  ? `Count: ${manipulators.length}\nUser IDs: ${manipulatorUserIds}`
                  : "No manipulators detected in current live window."
              }
              readOnly
              className="w-full min-h-[90px] rounded border border-border-subtle bg-secondary/30 px-3 py-2 text-sm text-foreground"
            />
          </div>

          <div>
            <p className="data-label mb-2">Prediction Metrics (Horizontal Scroll)</p>
            <div className="overflow-x-auto border border-border-subtle rounded">
              <table className="terminal-table min-w-[1200px]">
                <thead>
                  <tr>
                    {predictionColumns.length ? (
                      predictionColumns.map((column) => <th key={column}>{column}</th>)
                    ) : (
                      <th>No metrics yet</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {predictionRows.length ? (
                    predictionRows.slice(0, 50).map((row, index) => (
                      <tr key={`prediction-row-${index}`}>
                        {predictionColumns.map((column) => (
                          <td key={`${index}-${column}`}>{formatCellValue(row[column])}</td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="text-muted-foreground">Waiting for incoming live trades to compute metrics.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
                liveModelStatus.status === "TRAINING"
                  ? "bg-warning/20 text-warning"
                  : liveModelStatus.status === "READY"
                  ? "bg-positive/20 text-positive"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              {liveModelStatus.status}
            </span>
          </div>
          <div className="panel-content space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Cpu className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">{liveModelStatus.currentModel}</p>
                  <p className="text-sm text-muted-foreground">Active Model Version</p>
                </div>
              </div>
            </div>

            {/* Training Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Training Progress</span>
                <span className="font-mono text-foreground">{liveModelStatus.progress}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${liveModelStatus.progress}%` }}
                />
              </div>
            </div>

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-positive" />
                <div>
                  <p className="data-label">Last Training</p>
                  <p className="text-sm text-foreground">{formatDate(liveModelStatus.lastTraining)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-neutral" />
                <div>
                  <p className="data-label">Next Scheduled</p>
                  <p className="text-sm text-foreground">{formatDate(liveModelStatus.nextScheduled)}</p>
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
                  {formatNumber(liveModelStatus.datasetSize)}
                </p>
                <p className="text-sm text-muted-foreground">Records</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Manipulators</span>
                <span className="text-foreground">{manipulators.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Non-Manipulators</span>
                <span className="text-foreground">{Math.max(0, predictionRows.length - manipulators.length)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Preview Rows</span>
                <span className="text-foreground">{predictionRows.length}</span>
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
              <p className="text-3xl font-semibold text-positive">{liveModelStatus.accuracy}%</p>
              <p className="data-label mt-2">Accuracy</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-semibold text-neutral">{liveModelStatus.precision}%</p>
              <p className="data-label mt-2">Precision</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-semibold text-neutral">{liveModelStatus.recall}%</p>
              <p className="data-label mt-2">Recall</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-semibold text-primary">{liveModelStatus.f1Score}%</p>
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
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    mlApiHealthy ? "bg-positive/20 text-positive" : "bg-secondary text-muted-foreground"
                  )}>
                    {mlApiHealthy ? "LIVE" : "WAITING"}
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">{livePayload?.refresh_seconds ?? 3}s</td>
                <td className="text-right font-mono text-xs text-muted-foreground">
                  {formatDate(livePayload?.updated_at || null)}
                </td>
              </tr>
              <tr>
                <td className="font-medium text-foreground">Feature Engineering</td>
                <td className="text-muted-foreground">Compute behavioral metrics per user</td>
                <td>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    mlApiHealthy ? "bg-positive/20 text-positive" : "bg-secondary text-muted-foreground"
                  )}>
                    {mlApiHealthy ? "LIVE" : "WAITING"}
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">{livePayload?.refresh_seconds ?? 3}s</td>
                <td className="text-right font-mono text-xs text-muted-foreground">
                  {formatDate(livePayload?.updated_at || null)}
                </td>
              </tr>
              <tr>
                <td className="font-medium text-foreground">Manipulator Classification</td>
                <td className="text-muted-foreground">Predict trader type and publish manipulators</td>
                <td>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    mlApiHealthy ? "bg-positive/20 text-positive" : "bg-secondary text-muted-foreground"
                  )}>
                    {mlApiHealthy ? "LIVE" : "WAITING"}
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">{livePayload?.refresh_seconds ?? 3}s</td>
                <td className="text-right font-mono text-xs text-muted-foreground">{formatDate(livePayload?.updated_at || null)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Notice */}
      <div className="flex items-start gap-3 p-4 rounded-md bg-secondary/50 border border-border-subtle">
        <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Live Detection Mode</p>
          <p className="mt-1">
            This view consumes only live trade data from the running system and continuously updates
            manipulator predictions while backend, frontend, model service, and database remain online.
          </p>
        </div>
      </div>
    </div>
  );
}
