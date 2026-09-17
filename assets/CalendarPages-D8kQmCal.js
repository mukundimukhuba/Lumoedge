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

const SESSION_KEY = "ub-web/admin-session-v1";
const AUTH_KEY = "ub-web/admin-auth-v3";
const EMPTY_FORM = {
  eventName: "NFP",
  date: "",
  time: "14:30",
  currency: "USD",
  impact: "HIGH",
  symbol: "XAUUSD",
  direction: "BUY",
  message: "NFP BUY — Execute the news trade when the signal becomes active.",
  activationAt: "",
  expirationAt: "",
  expirationHours: "5",
  takeProfit: "",
  stopLoss: "",
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function sessionHeaders() {
  const session = readJson(SESSION_KEY, {});
  const headers = { "Content-Type": "application/json" };
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
    headers["x-lumo-session"] = session.token;
  }
  if (session?.adminId) headers["x-lumo-admin-id"] = session.adminId;
  return headers;
}

async function api(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: { ...sessionHeaders(), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function Badge({ status }) {
  const label = String(status || "draft");
  return Y.jsx("span", { className: `calendar-chip ${label.toLowerCase()}`, children: label });
}

function Field({ label, children }) {
  return Y.jsxs("div", { className: "calendar-field", children: [Y.jsx("label", { children: label }), children] });
}

function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function SignalForm({ superEa, initial, busy, onSubmit, onCancel }) {
  const [form, setForm] = R.useState(() => ({ ...EMPTY_FORM, ...initial }));
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const eaName = superEa?.name || superEa?.id || "Your EA";
  return Y.jsxs("form", {
    className: "calendar-card",
    onSubmit: (ev) => {
      ev.preventDefault();
      onSubmit({
        ...form,
        botId: superEa?.id || "",
        botName: eaName,
        status: initial?.id ? undefined : "published",
        activationAt: fromLocalInput(form.activationAt) || undefined,
        expirationAt: fromLocalInput(form.expirationAt) || undefined,
        takeProfit: form.takeProfit,
        stopLoss: form.stopLoss,
        expirationHours: fromLocalInput(form.expirationAt) ? undefined : Number(form.expirationHours) || 5,
      });
    },
    children: [
      Y.jsx("h3", { style: { margin: 0 }, children: initial?.id ? "Edit signal" : "Send signal" }),
      Y.jsxs("div", {
        className: "calendar-grid",
        children: [
          Y.jsx(Field, { label: "EVENT NAME", children: Y.jsx("input", { value: form.eventName, onChange: (ev) => set("eventName", ev.target.value), required: true }) }),
          Y.jsx(Field, { label: "DATE", children: Y.jsx("input", { type: "date", value: form.date, onChange: (ev) => set("date", ev.target.value), required: true }) }),
          Y.jsx(Field, { label: "TIME", children: Y.jsx("input", { type: "time", value: form.time, onChange: (ev) => set("time", ev.target.value), required: true }) }),
          Y.jsx(Field, { label: "CURRENCY", children: Y.jsx("input", { value: form.currency, onChange: (ev) => set("currency", ev.target.value.toUpperCase()), required: true }) }),
          Y.jsxs(Field, {
            label: "IMPACT",
            children: [
              Y.jsxs("select", {
                value: form.impact,
                onChange: (ev) => set("impact", ev.target.value),
                children: [
                  Y.jsx("option", { value: "HIGH", children: "HIGH" }),
                  Y.jsx("option", { value: "MEDIUM", children: "MEDIUM" }),
                  Y.jsx("option", { value: "LOW", children: "LOW" }),
                ],
              }),
            ],
          }),
          Y.jsx(Field, {
            label: "YOUR EA",
            children: Y.jsx("input", { value: eaName, readOnly: true }),
          }),
          Y.jsx(Field, { label: "SYMBOL", children: Y.jsx("input", { value: form.symbol, onChange: (ev) => set("symbol", ev.target.value.toUpperCase()), required: true }) }),
          Y.jsxs(Field, {
            label: "DIRECTION",
            children: [
              Y.jsxs("select", {
                value: form.direction,
                onChange: (ev) => set("direction", ev.target.value),
                children: [
                  Y.jsx("option", { value: "BUY", children: "BUY" }),
                  Y.jsx("option", { value: "SELL", children: "SELL" }),
                ],
              }),
            ],
          }),
          Y.jsx(Field, { label: "ACTIVATION TIME", children: Y.jsx("input", { type: "datetime-local", value: form.activationAt, onChange: (ev) => set("activationAt", ev.target.value) }) }),
          Y.jsx(Field, { label: "EXPIRATION TIME", children: Y.jsx("input", { type: "datetime-local", value: form.expirationAt, onChange: (ev) => set("expirationAt", ev.target.value) }) }),
          Y.jsx(Field, { label: "EXPIRATION (HOURS, DEFAULT 5)", children: Y.jsx("input", { type: "number", min: "1", step: "1", value: form.expirationHours, onChange: (ev) => set("expirationHours", ev.target.value) }) }),
          Y.jsx(Field, { label: "TAKE PROFIT", children: Y.jsx("input", { placeholder: "NONE", value: form.takeProfit, onChange: (ev) => set("takeProfit", ev.target.value) }) }),
          Y.jsx(Field, { label: "STOP LOSS", children: Y.jsx("input", { placeholder: "NONE", value: form.stopLoss, onChange: (ev) => set("stopLoss", ev.target.value) }) }),
        ],
      }),
      Y.jsx(Field, {
        label: "MESSAGE",
        children: Y.jsx("textarea", { rows: 3, value: form.message, onChange: (ev) => set("message", ev.target.value) }),
      }),
      Y.jsxs("div", {
        className: "calendar-actions",
        children: [
          Y.jsx("button", { type: "submit", className: "btn btn-blue", disabled: busy, children: busy ? "Sending…" : initial?.id ? "Save changes" : "Send signal" }),
          onCancel
            ? Y.jsx("button", { type: "button", className: "btn btn-ghost", onClick: onCancel, children: "Cancel" })
            : null,
        ],
      }),
    ],
  });
}

function CalendarAdminPage() {
  const admin = readJson(AUTH_KEY, {})?.admin || null;
  const [bots, setBots] = R.useState([]);
  const [signals, setSignals] = R.useState([]);
  const [view, setView] = R.useState("all");
  const [error, setError] = R.useState("");
  const [notice, setNotice] = R.useState("");
  const [busy, setBusy] = R.useState(false);
  const [editing, setEditing] = R.useState(null);
  const [showForm, setShowForm] = R.useState(false);

  const load = R.useCallback(async () => {
    const [botData, signalData] = await Promise.all([
      api("/api/calendar/admin/bots"),
      api(`/api/calendar/admin/signals?view=${encodeURIComponent(view)}`),
    ]);
    setBots(botData.bots || []);
    setSignals(signalData.signals || []);
  }, [view]);

  R.useEffect(() => {
    load().catch((err) => setError(err.message || "Could not load calendar."));
  }, [load]);

  async function run(fn, okMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      if (okMessage) setNotice(okMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (admin && admin.role !== "super") {
    return Y.jsx("p", { className: "calendar-empty", children: "Only Super Admin can manage economic calendar signals." });
  }

  return Y.jsxs("div", {
    className: "calendar-page",
    children: [
      Y.jsx("p", { className: "calendar-kicker", children: "SUPER ADMIN" }),
      Y.jsx("h1", { className: "calendar-title", children: "Economic Calendar Signals" }),
      Y.jsx("p", { className: "calendar-lead", children: "News signals send on your EA only. Licensed students on your EA see them — you do not pick other bots." }),
      error ? Y.jsx("p", { className: "error", children: error }) : null,
      notice ? Y.jsx("p", { style: { margin: 0, color: "var(--green)", fontWeight: 700 }, children: notice }) : null,
      Y.jsxs("div", {
        className: "calendar-actions",
        children: [
          ...[
            ["active", "Active"],
            ["expired", "Expired"],
            ["all", "All"],
          ].map(([id, label]) =>
            Y.jsx(
              "button",
              {
                type: "button",
                className: view === id ? "btn btn-blue" : "btn btn-ghost",
                onClick: () => setView(id),
                children: label,
              },
              id,
            ),
          ),
          Y.jsx("button", {
            type: "button",
            className: "btn btn-blue",
            onClick: () => {
              setEditing(null);
              setShowForm(true);
            },
            children: "Send signal",
          }),
        ],
      }),
      showForm
        ? Y.jsx(SignalForm, {
            superEa: bots[0] || { id: "ea-lumo-edge", name: "Lumo Edge" },
            initial: editing
              ? {
                  ...EMPTY_FORM,
                  ...editing,
                  date: editing.eventDate || editing.date || "",
                  time: editing.eventTime || editing.time || "",
                  activationAt: toLocalInput(editing.activationAt),
                  expirationAt: toLocalInput(editing.expirationAt),
                  expirationHours: "5",
                  takeProfit: editing.takeProfit ?? "",
                  stopLoss: editing.stopLoss ?? "",
                }
              : EMPTY_FORM,
            busy,
            onCancel: () => {
              setShowForm(false);
              setEditing(null);
            },
            onSubmit: (payload) =>
              run(async () => {
                if (editing?.id) {
                  await api(`/api/calendar/admin/signals/${encodeURIComponent(editing.id)}`, {
                    method: "PUT",
                    body: JSON.stringify(payload),
                  });
                } else {
                  await api("/api/calendar/admin/signals", {
                    method: "POST",
                    body: JSON.stringify(payload),
                  });
                }
                setShowForm(false);
                setEditing(null);
              }, editing?.id ? "Signal updated." : "Signal sent to your EA students."),
          })
        : null,
      signals.length
        ? Y.jsx("div", {
            className: "calendar-table-wrap",
            children: Y.jsxs("table", {
              className: "calendar-table",
              children: [
                Y.jsx("thead", {
                  children: Y.jsxs("tr", {
                    children: [
                      Y.jsx("th", { children: "Event" }),
                      Y.jsx("th", { children: "Your EA" }),
                      Y.jsx("th", { children: "Signal" }),
                      Y.jsx("th", { children: "Window" }),
                      Y.jsx("th", { children: "Status" }),
                      Y.jsx("th", { children: "Actions" }),
                    ],
                  }),
                }),
                Y.jsx("tbody", {
                  children: signals.map((row) =>
                    Y.jsxs(
                      "tr",
                      {
                        children: [
                          Y.jsxs("td", {
                            children: [
                              Y.jsx("strong", { children: row.eventName }),
                              Y.jsx("div", { children: `${row.eventDate || ""} ${row.eventTime || ""} ${row.currency || ""}` }),
                            ],
                          }),
                          Y.jsx("td", { children: row.botName || row.botId }),
                          Y.jsx("td", { children: `${row.symbol} ${row.direction}` }),
                          Y.jsx("td", { children: `${row.activationAt || ""} → ${row.expirationAt || ""}` }),
                          Y.jsx("td", { children: Y.jsx(Badge, { status: row.derivedStatus || row.status }) }),
                          Y.jsxs("td", {
                            children: [
                              Y.jsxs("div", {
                                className: "calendar-actions",
                                children: [
                                  Y.jsx("button", {
                                    type: "button",
                                    className: "btn btn-ghost",
                                    onClick: () => {
                                      setEditing(row);
                                      setShowForm(true);
                                    },
                                    children: "Edit",
                                  }),
                                  row.status !== "published"
                                    ? Y.jsx("button", {
                                        type: "button",
                                        className: "btn btn-blue",
                                        disabled: busy,
                                        onClick: () =>
                                          run(
                                            () =>
                                              api(`/api/calendar/admin/signals/${encodeURIComponent(row.id)}/publish`, {
                                                method: "POST",
                                              }),
                                            "Signal published.",
                                          ),
                                        children: "Publish",
                                      })
                                    : Y.jsx("button", {
                                        type: "button",
                                        className: "btn btn-ghost",
                                        disabled: busy,
                                        onClick: () =>
                                          run(
                                            () =>
                                              api(`/api/calendar/admin/signals/${encodeURIComponent(row.id)}/deactivate`, {
                                                method: "POST",
                                              }),
                                            "Signal deactivated.",
                                          ),
                                        children: "Deactivate",
                                      }),
                                  Y.jsx("button", {
                                    type: "button",
                                    className: "btn btn-ghost",
                                    disabled: busy,
                                    onClick: () => {
                                      if (!confirm("Delete this signal record?")) return;
                                      run(
                                        () =>
                                          api(`/api/calendar/admin/signals/${encodeURIComponent(row.id)}`, {
                                            method: "DELETE",
                                          }),
                                        "Signal deleted.",
                                      );
                                    },
                                    children: "Delete",
                                  }),
                                ],
                              }),
                            ],
                          }),
                        ],
                      },
                      row.id,
                    ),
                  ),
                }),
              ],
            }),
          })
        : Y.jsx("p", { className: "calendar-empty", children: "No signals in this view." }),
    ],
  });
}

export { CalendarAdminPage, CalendarAdminPage as default };
