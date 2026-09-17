import { i as e, t } from "./react-B8IZ02wI.js";
import { n as o } from "./createLucideIcon-DyCq-HOk.js";
import { r as apiUrl } from "./apiBase-CDudBPOx.js";

if (typeof document !== "undefined" && !document.querySelector("link[data-calendar-css]")) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/calendar-D8kQmCal.css";
  link.dataset.calendarCss = "1";
  document.head.appendChild(link);
}

var R = e(t(), 1);
var Y = o();

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function studentAuth() {
  const session = readJson("ub-web/session-v2", null) || {};
  const email = String(session?.user?.email || "").trim().toLowerCase();
  const licenseKey = String(session?.bot?.licenseKey || "").trim();
  const mt5 = readJson("ub-web/mt5-session-v1", {}) || {};
  const token = String(mt5[email]?.token || "").trim();
  return { email, licenseKey, mt5Id: token };
}

function formatCountdown(ms) {
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "NOW";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}H ${m} MINUTES`;
  if (m > 0) return `${m} MINUTE${m === 1 ? "" : "S"} UNTIL NEWS`;
  return `${s} SECONDS UNTIL NEWS`;
}

function priceLabel(value) {
  return value == null || value === "" ? "NONE" : String(value);
}

function ConfirmModal({ signal, onCancel, onConfirm, busy }) {
  return Y.jsx("div", {
    className: "calendar-modal",
    children: Y.jsxs("div", {
      className: "calendar-modal-card",
      children: [
        Y.jsx("p", { className: "calendar-warn", children: "⚠️ NEWS TRADE" }),
        Y.jsx("strong", { children: signal.symbol }),
        Y.jsx("div", { children: signal.direction }),
        Y.jsxs("div", { children: ["Take Profit: ", priceLabel(signal.takeProfit)] }),
        Y.jsxs("div", { children: ["Stop Loss: ", priceLabel(signal.stopLoss)] }),
        Y.jsx("p", { className: "calendar-lead", children: "Market conditions can change rapidly." }),
        Y.jsxs("div", {
          className: "calendar-actions",
          children: [
            Y.jsx("button", { type: "button", className: "btn btn-ghost", onClick: onCancel, disabled: busy, children: "CANCEL" }),
            Y.jsx("button", { type: "button", className: "btn btn-blue", onClick: onConfirm, disabled: busy, children: busy ? "EXECUTING…" : "CONFIRM EXECUTE" }),
          ],
        }),
      ],
    }),
  });
}

function EventCard({ event, signal, nowMs, onExecute }) {
  const targetMs = signal
    ? Date.parse(signal.status === "upcoming" ? signal.activationAt : signal.expirationAt)
    : Date.parse(event.at);
  const remaining = Number.isFinite(targetMs) ? targetMs - nowMs : event.remainingMs;
  const active = signal?.status === "active";
  const executed = Boolean(signal?.executed);
  return Y.jsxs("article", {
    className: `calendar-card${active ? " is-active" : ""}`,
    children: [
      Y.jsxs("div", {
        className: "calendar-row",
        children: [
          Y.jsx("h2", { style: { margin: 0 }, children: event.name || signal?.eventName || "Event" }),
          Y.jsx("span", { className: `calendar-chip ${(event.impact || "high").toLowerCase()}`, children: `${event.impact || "HIGH"} IMPACT` }),
        ],
      }),
      Y.jsxs("div", {
        className: "calendar-meta",
        children: [
          Y.jsx("span", { className: "calendar-chip", children: event.currency || signal?.currency || "" }),
          Y.jsx("span", { className: "calendar-chip", children: event.time || signal?.eventTime || "" }),
          Y.jsx("span", { className: "calendar-chip", children: event.date || "" }),
        ],
      }),
      Y.jsx("p", {
        className: "calendar-count",
        children: active ? "NEWS SIGNAL ACTIVE" : formatCountdown(remaining),
      }),
      signal
        ? Y.jsxs("div", {
            className: "calendar-signal",
            children: [
              Y.jsx("div", { children: "SIGNAL:" }),
              Y.jsxs("strong", { children: [signal.symbol, " ", signal.direction] }),
              signal.message ? Y.jsx("p", { className: "calendar-lead", children: signal.message }) : null,
              executed
                ? Y.jsx("p", { className: "calendar-count", children: "TRADE ALREADY EXECUTED FOR THIS SIGNAL" })
                : active
                  ? Y.jsx("button", {
                      type: "button",
                      className: "btn btn-blue",
                      onClick: () => onExecute(signal),
                      children: "EXECUTE TRADE",
                    })
                  : Y.jsx("p", { className: "calendar-lead", children: "Execute becomes available when the news window opens." }),
            ],
          })
        : Y.jsx("p", { className: "calendar-lead", children: "Upcoming news — no signal yet." }),
    ],
  });
}

function CalendarStudentPage() {
  const auth = studentAuth();
  const [data, setData] = R.useState(null);
  const [error, setError] = R.useState("");
  const [notice, setNotice] = R.useState("");
  const [nowMs, setNowMs] = R.useState(Date.now());
  const [offset, setOffset] = R.useState(0);
  const [confirm, setConfirm] = R.useState(null);
  const [busy, setBusy] = R.useState(false);

  const load = R.useCallback(async () => {
    if (!auth.email || !auth.licenseKey) {
      throw new Error("Active license required.");
    }
    const url = apiUrl(
      `/api/calendar?email=${encodeURIComponent(auth.email)}&licenseKey=${encodeURIComponent(auth.licenseKey)}&v=cal-gone3`,
    );
    const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not load calendar");
    setData(body);
    const serverMs = Number(body.serverNowMs) || Date.parse(body.serverNow) || Date.now();
    setOffset(serverMs - Date.now());
  }, [auth.email, auth.licenseKey]);

  R.useEffect(() => {
    load().catch((err) => setError(err.message || "Could not load calendar."));
    const refresh = () => load().catch(() => {});
    const timer = window.setInterval(refresh, 15000);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  R.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now() + offset), 1000);
    return () => window.clearInterval(timer);
  }, [offset]);

  async function confirmExecute() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(apiUrl("/api/calendar/execute"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: auth.email,
          licenseKey: auth.licenseKey,
          signalId: confirm.id,
          mt5Id: auth.mt5Id,
          volume: 0.01,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Trade rejected");
      setNotice("Trade executed.");
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trade rejected");
    } finally {
      setBusy(false);
    }
  }

  const events = data?.events || [];
  const signals = data?.signals || [];
  const byEvent = new Map(signals.map((row) => [row.eventId, row]));
  const extraSignals = signals.filter(
    (row) => !events.some((event) => event.id === row.eventId || event.name === row.eventName),
  );

  return Y.jsxs("div", {
    className: "calendar-page",
    children: [
      Y.jsx("p", { className: "calendar-kicker", children: "STUDENT" }),
      Y.jsx("h1", { className: "calendar-title", children: "Economic Calendar" }),
      Y.jsx("p", { className: "calendar-lead", children: "Upcoming NFP, CPI, PPI, and FOMC. A private signal appears only if Super Admin sends one for your EA." }),
      error ? Y.jsx("p", { className: "error", children: error }) : null,
      notice ? Y.jsx("p", { style: { margin: 0, color: "var(--green)", fontWeight: 700 }, children: notice }) : null,
      events.length || extraSignals.length
        ? Y.jsxs("div", {
            style: { display: "grid", gap: "14px" },
            children: [
              events.map((event) =>
                Y.jsx(
                  EventCard,
                  {
                    event,
                    signal: byEvent.get(event.id),
                    nowMs,
                    onExecute: setConfirm,
                  },
                  event.id,
                ),
              ),
              extraSignals.map((signal) =>
                Y.jsx(
                  EventCard,
                  {
                    event: {
                      name: signal.eventName,
                      impact: "HIGH",
                      currency: "",
                      time: "",
                      date: "",
                      at: signal.activationAt,
                      remainingMs: signal.remainingMs,
                    },
                    signal,
                    nowMs,
                    onExecute: setConfirm,
                  },
                  signal.id,
                ),
              ),
            ],
          })
        : Y.jsx("p", { className: "calendar-empty", children: data ? "No active economic events." : "Loading calendar…" }),
      confirm
        ? Y.jsx(ConfirmModal, {
            signal: confirm,
            busy,
            onCancel: () => setConfirm(null),
            onConfirm: confirmExecute,
          })
        : null,
    ],
  });
}

export { CalendarStudentPage, CalendarStudentPage as default };
