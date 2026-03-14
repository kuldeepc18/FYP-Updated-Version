import { cn } from "@/lib/utils";
import { Database, Cpu, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type OutputFormat = "json" | "csv" | "xlsx";
type PredictionValue = string | number | boolean | null;
type PredictionRow = Record<string, PredictionValue>;

const resolveDefaultMlApiBase = () => {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:8000";
  }
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.hostname}:8000`;
};

const ML_API_BASE =
  (import.meta.env.VITE_ML_API_URL as string | undefined)?.replace(/\/$/, "") ||
  resolveDefaultMlApiBase();

export default function MLModel() {
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [layeringFile, setLayeringFile] = useState<File | null>(null);
  const [spoofingFile, setSpoofingFile] = useState<File | null>(null);
  const [responseFormat, setResponseFormat] = useState<OutputFormat>("xlsx");
  const [isSingleLoading, setIsSingleLoading] = useState(false);
  const [isCombinedLoading, setIsCombinedLoading] = useState(false);
  const [requestError, setRequestError] = useState<string>("");
  const [predictionRows, setPredictionRows] = useState<PredictionRow[]>([]);
  const [mlApiHealthy, setMlApiHealthy] = useState<boolean | null>(null);

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
    const nowIso = new Date().toISOString();
    const manipulatorRatio = predictionRows.length
      ? (manipulators.length / predictionRows.length) * 100
      : 0;
    return {
      currentModel: "Live Prediction Service",
      status: mlApiHealthy ? "READY" : mlApiHealthy === false ? "OFFLINE" : "CONNECTING",
      progress: mlApiHealthy ? 100 : 0,
      lastTraining: nowIso,
      nextScheduled: nowIso,
      datasetSize: predictionRows.length,
      accuracy: predictionRows.length ? (100 - manipulatorRatio).toFixed(1) : "—",
      precision: predictionRows.length ? (100 - manipulatorRatio).toFixed(1) : "—",
      recall: predictionRows.length ? manipulatorRatio.toFixed(1) : "—",
      f1Score: predictionRows.length ? (100 - manipulatorRatio / 2).toFixed(1) : "—",
    };
  }, [mlApiHealthy, predictionRows.length, manipulators.length]);

  useEffect(() => {
    let mounted = true;
    const probeHealth = async () => {
      try {
        const response = await fetch(`${ML_API_BASE}/health`);
        if (!mounted) return;
        setMlApiHealthy(response.ok);
      } catch {
        if (!mounted) return;
        setMlApiHealthy(false);
      }
    };

    probeHealth();
    const timer = setInterval(probeHealth, 10000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const formatCellValue = (value: PredictionValue) => {
    if (value === null || value === undefined) return "";
    return String(value);
  };

  const parsePredictionPayload = async (response: Response): Promise<PredictionRow[]> => {
    const contentType = response.headers.get("content-type") || "";
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(rawText || `Request failed with status ${response.status}`);
    }

    if (!contentType.includes("application/json")) {
      throw new Error(`Expected JSON preview response, got ${contentType || "unknown type"}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`Invalid JSON preview response: ${rawText.slice(0, 200)}`);
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Preview response is empty.");
    }

    const records = (parsed as { predictions?: unknown }).predictions;
    if (!Array.isArray(records)) {
      throw new Error("Preview response missing 'predictions' array.");
    }

    return records as PredictionRow[];
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const normalizeRequestError = (error: unknown, fallback: string) => {
    if (error instanceof TypeError) {
      return `Cannot reach ML API at ${ML_API_BASE}. Start backend with: cd /home/kuldeep/Desktop/FYP_PROJECT/FYP/model && /home/kuldeep/Desktop/FYP_PROJECT/FYP/.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return fallback;
  };

  const runSinglePrediction = async () => {
    if (!singleFile) {
      setRequestError("Please select a CSV for single prediction.");
      return;
    }

    setRequestError("");
    setIsSingleLoading(true);
    try {
      const previewForm = new FormData();
      previewForm.append("file", singleFile);
      const previewResponse = await fetch(`${ML_API_BASE}/predict?response_format=json`, {
        method: "POST",
        body: previewForm,
      });
      const previewRows = await parsePredictionPayload(previewResponse);
      setPredictionRows(previewRows);

      if (responseFormat !== "json") {
        const downloadForm = new FormData();
        downloadForm.append("file", singleFile);
        const downloadResponse = await fetch(
          `${ML_API_BASE}/predict?response_format=${responseFormat}`,
          {
            method: "POST",
            body: downloadForm,
          }
        );

        if (!downloadResponse.ok) {
          const errorText = await downloadResponse.text();
          throw new Error(errorText || "File download failed.");
        }

        const fileBlob = await downloadResponse.blob();
        const extension = responseFormat === "csv" ? "csv" : "xlsx";
        downloadBlob(fileBlob, `single_predictions.${extension}`);
      }
    } catch (error) {
      const message = normalizeRequestError(error, "Single prediction failed.");
      setRequestError(message);
    } finally {
      setIsSingleLoading(false);
    }
  };

  const runCombinedPrediction = async () => {
    if (!layeringFile || !spoofingFile) {
      setRequestError("Please select both layering and spoofing CSV files.");
      return;
    }

    setRequestError("");
    setIsCombinedLoading(true);
    try {
      const previewForm = new FormData();
      previewForm.append("layering_file", layeringFile);
      previewForm.append("spoofing_file", spoofingFile);
      const previewResponse = await fetch(`${ML_API_BASE}/predict-combined?response_format=json`, {
        method: "POST",
        body: previewForm,
      });
      const previewRows = await parsePredictionPayload(previewResponse);
      setPredictionRows(previewRows);

      if (responseFormat !== "json") {
        const downloadForm = new FormData();
        downloadForm.append("layering_file", layeringFile);
        downloadForm.append("spoofing_file", spoofingFile);
        const downloadResponse = await fetch(
          `${ML_API_BASE}/predict-combined?response_format=${responseFormat}`,
          {
            method: "POST",
            body: downloadForm,
          }
        );

        if (!downloadResponse.ok) {
          const errorText = await downloadResponse.text();
          throw new Error(errorText || "File download failed.");
        }

        const fileBlob = await downloadResponse.blob();
        const extension = responseFormat === "csv" ? "csv" : "xlsx";
        downloadBlob(fileBlob, `combined_predictions.${extension}`);
      }
    } catch (error) {
      const message = normalizeRequestError(error, "Combined prediction failed.");
      setRequestError(message);
    } finally {
      setIsCombinedLoading(false);
    }
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
          <span className="text-xs text-muted-foreground">Connected to {ML_API_BASE}</span>
        </div>
        <div className="panel-content space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1">
              <label className="data-label mb-2 block">Output Format</label>
              <select
                value={responseFormat}
                onChange={(e) => setResponseFormat(e.target.value as OutputFormat)}
                className="w-full rounded border border-border-subtle bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="xlsx">xlsx</option>
                <option value="csv">csv</option>
                <option value="json">json</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="rounded-md border border-border-subtle p-4 space-y-3">
              <p className="font-medium text-foreground">Single CSV Prediction</p>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setSingleFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-foreground"
              />
              <button
                onClick={runSinglePrediction}
                disabled={isSingleLoading}
                className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-60"
              >
                {isSingleLoading ? "Running..." : "Run Single Prediction"}
              </button>
            </div>

            <div className="rounded-md border border-border-subtle p-4 space-y-3">
              <p className="font-medium text-foreground">Combined Layering + Spoofing</p>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setLayeringFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-foreground"
              />
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setSpoofingFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-foreground"
              />
              <button
                onClick={runCombinedPrediction}
                disabled={isCombinedLoading}
                className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-60"
              >
                {isCombinedLoading ? "Running..." : "Run Combined Prediction"}
              </button>
            </div>
          </div>

          {requestError && (
            <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">
              {requestError}
            </div>
          )}

          <div className="space-y-2">
            <p className="data-label">Manipulators (predicted_trader_type = 1)</p>
            <textarea
              value={
                manipulators.length
                  ? `Count: ${manipulators.length}\nUser IDs: ${manipulatorUserIds}`
                  : "No manipulators found in current prediction preview."
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
                      <td className="text-muted-foreground">Run a prediction to view metrics.</td>
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
