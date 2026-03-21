import { useEffect, useMemo, useRef, useState } from "react";
import { ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getManipulatorUsers,
  getSurveillanceUserTrades,
  type ManipulatorUser,
  type TradeRecord,
} from "@/data/apiMarketData";

const REAL_USER_MIN_ID = 10000;

const normalizeTrackableUserId = (value: unknown): string | null => {
  const numeric = Number(String(value ?? "").trim());
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric <= REAL_USER_MIN_ID) {
    return null;
  }
  return String(numeric);
};

export default function Surveillance() {
  const [manipulatorUsers, setManipulatorUsers] = useState<ManipulatorUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [searchUserId, setSearchUserId] = useState<string>("");
  const [tradeLogs, setTradeLogs] = useState<TradeRecord[]>([]);
  const [displayedUserId, setDisplayedUserId] = useState<string>("");
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isTradesLoading, setIsTradesLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const tradeFetchSeq = useRef(0);

  const manipulatorUserIds = useMemo(() => {
    const ids = manipulatorUsers
      .map((entry) => normalizeTrackableUserId(entry.user_id))
      .filter((value): value is string => value !== null);
    return Array.from(new Set(ids)).sort((a, b) => Number(a) - Number(b));
  }, [manipulatorUsers]);

  const activeManipulatorCount = useMemo(
    () => manipulatorUsers.filter((entry) => !!entry.is_active).length,
    [manipulatorUsers]
  );

  const loadManipulatorUsers = async () => {
    setIsUsersLoading(true);
    try {
      const users = await getManipulatorUsers();
      setManipulatorUsers(users);

      const ids = users
        .map((entry) => normalizeTrackableUserId(entry.user_id))
        .filter((value): value is string => value !== null)
        .sort((a, b) => Number(a) - Number(b));

      if (ids.length > 0) {
        setSelectedUserId((previous) => previous || ids[0]);
        setSearchUserId((previous) => previous || ids[0]);
      }
    } finally {
      setIsUsersLoading(false);
    }
  };

  const loadTradeLogs = async (userId: string) => {
    const normalized = normalizeTrackableUserId(userId);
    if (!normalized) {
      setErrorMessage(`Enter a valid real user_id greater than ${REAL_USER_MIN_ID}.`);
      return;
    }

    const seq = ++tradeFetchSeq.current;
    setIsTradesLoading(true);
    try {
      const rows = await getSurveillanceUserTrades(normalized, 1000);
      if (seq !== tradeFetchSeq.current) return;
      setTradeLogs(rows);
      setSelectedUserId(normalized);
      setDisplayedUserId(normalized);
      setErrorMessage("");
    } catch {
      if (seq !== tradeFetchSeq.current) return;
      setErrorMessage("Failed to fetch trade logs for selected user.");
    } finally {
      if (seq === tradeFetchSeq.current) {
        setIsTradesLoading(false);
      }
    }
  };

  useEffect(() => {
    loadManipulatorUsers();
    const timer = setInterval(loadManipulatorUsers, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedUserId) return;
    loadTradeLogs(selectedUserId);
  }, [selectedUserId]);

  const onSelectChange = async (userId: string) => {
    const normalized = normalizeTrackableUserId(userId);
    if (!normalized) return;
    setSelectedUserId(normalized);
    setSearchUserId(userId);
    await loadTradeLogs(normalized);
  };

  const onSearchSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await loadTradeLogs(searchUserId);
  };

  const formatTime = (isoString: string) => {
    if (!isoString) return "—";
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) return "—";
    return parsed.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">AI Market Surveillance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time trade-log surveillance for manipulative users (user_id &gt; {REAL_USER_MIN_ID})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ScanSearch className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-primary">Surveillance Active</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="panel"><div className="p-4"><p className="data-label">Tracked Manipulator Users</p><p className="text-2xl font-semibold text-foreground mt-1">{manipulatorUserIds.length}</p></div></div>
        <div className="panel"><div className="p-4"><p className="data-label">Currently Active</p><p className="text-2xl font-semibold text-warning mt-1">{activeManipulatorCount}</p></div></div>
        <div className="panel"><div className="p-4"><p className="data-label">Selected User</p><p className="text-2xl font-semibold text-primary mt-1">{displayedUserId || selectedUserId || "—"}</p></div></div>
        <div className="panel"><div className="p-4"><p className="data-label">Fetched Trade Logs</p><p className="text-2xl font-semibold text-neutral mt-1">{tradeLogs.length}</p></div></div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Manipulator User Controls</h2>
          <span className="text-xs text-muted-foreground">Dynamic dropdown updates from ML manipulator tracking</span>
        </div>
        <div className="panel-content grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="data-label">Select Manipulator User (Dynamic)</p>
            <select
              value={selectedUserId}
              onChange={(event) => onSelectChange(event.target.value)}
              className="w-full rounded border border-border-subtle bg-background px-3 py-2 text-sm text-foreground"
              disabled={manipulatorUserIds.length === 0}
            >
              {manipulatorUserIds.length === 0 ? (
                <option value="">No manipulator users tracked yet</option>
              ) : (
                manipulatorUserIds.map((userId) => (
                  <option key={userId} value={userId}>
                    {userId}
                  </option>
                ))
              )}
            </select>
          </div>

          <form onSubmit={onSearchSubmit} className="space-y-2">
            <p className="data-label">Search by User ID</p>
            <div className="flex items-center gap-2">
              <input
                value={searchUserId}
                onChange={(event) => setSearchUserId(event.target.value)}
                placeholder={`Enter user_id > ${REAL_USER_MIN_ID}`}
                className="w-full rounded border border-border-subtle bg-background px-3 py-2 text-sm text-foreground"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-60"
                disabled={isTradesLoading}
              >
                Search
              </button>
            </div>
          </form>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-md border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">
          {errorMessage}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Trade Logs of Manipulative User</h2>
          <span className={cn("text-xs", isTradesLoading ? "text-warning" : "text-muted-foreground")}>
            {isTradesLoading ? "Refreshing..." : "Live trade_logs data"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User ID</th>
                <th>Order ID</th>
                <th>Instrument</th>
                <th>Side</th>
                <th>Order Type</th>
                <th>Status</th>
                <th className="text-right">Price</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Filled</th>
              </tr>
            </thead>
            <tbody>
              {tradeLogs.length > 0 ? (
                tradeLogs.map((row) => (
                  <tr key={`${row.order_id}-${row.timestamp}`}>
                    <td className="font-mono text-xs text-muted-foreground">{formatTime(row.timestamp)}</td>
                    <td className="font-mono text-foreground">{row.user_id}</td>
                    <td className="font-mono text-xs text-muted-foreground">{row.order_id}</td>
                    <td className="text-foreground">{row.instrument_name}</td>
                    <td className={cn("font-medium", row.side === "BUY" ? "text-positive" : "text-negative")}>{row.side}</td>
                    <td className="text-foreground">{row.order_type}</td>
                    <td className="text-foreground">{row.status}</td>
                    <td className="text-right font-mono text-foreground">{row.price}</td>
                    <td className="text-right font-mono text-foreground">{row.quantity}</td>
                    <td className="text-right font-mono text-foreground">{row.filled_quantity}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="text-muted-foreground">
                    {displayedUserId
                      ? "No trade logs found for selected user in current query window."
                      : "Select or search a manipulator user_id to load trade logs."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
