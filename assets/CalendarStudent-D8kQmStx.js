import { i as e, t } from "./react-B8IZ02wI.js";
import { n as o } from "./createLucideIcon-DyCq-HOk.js";
import { r as apiUrl } from "./apiBase-CDudBPOx.js";

if (typeof document !== "undefined") {
  const href = "/assets/calendar-D8kQmCal.css?v=trapdesk4";
  let link = document.querySelector("link[data-calendar-css]");
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.calendarCss = "1";
    document.head.appendChild(link);
  }
  if (link.getAttribute("href") !== href) link.href = href;
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
  const session = readJson("ub-web/session-v2", null) || readJson("ub-web/session-v1", null) || {};
  const email = String(session?.user?.email || session?.email || "").trim().toLowerCase();
  let licenseKey = String(
    session?.bot?.licenseKey || session?.licenseKey || session?.user?.licenseKey || "",
  ).trim();
  const mt5 = readJson("ub-web/mt5-session-v1", {}) || {};
  const clientMt5 = readJson("ub-web/client-mt5-v1", {}) || {};
  const client = readJson("ub-web/clients-v1", {}) || {};
  if (!licenseKey) {
    licenseKey = String(
      mt5[email]?.licenseKey ||
        clientMt5[email]?.licenseKey ||
        clientMt5?.licenseKey ||
        client?.[email]?.licenseKey ||
        "",
    ).trim();
  }
  const token = String(mt5[email]?.token || clientMt5[email]?.token || "").trim();
  const mentorName = String(
    session?.bot?.displayName || session?.bot?.name || session?.bot?.eaName || "Unlimited bull",
  ).trim();
  return { email, licenseKey, mt5Id: token, mentorName };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatSastClock(ms) {
  if (!Number.isFinite(ms)) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Johannesburg",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const hour = parts.find((p) => p.type === "hour")?.value || "00";
    const minute = parts.find((p) => p.type === "minute")?.value || "00";
    return `${hour}:${minute} SAST`;
  } catch {
    const d = new Date(ms);
    return `${pad(d.getUTCHours() + 2)}:${pad(d.getUTCMinutes())} SAST`;
  }
}

function formatLongDate(ms) {
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Johannesburg",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toDateString();
  }
}

function formatMinutesLeft(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  return `${Math.max(1, Math.ceil(ms / 60000))} min`;
}

function mentorLabel(signal, fallback = "Unlimited bull") {
  return String(signal?.mentorName || signal?.botName || fallback || "Unlimited bull").trim() || "Unlimited bull";
}

function signalHeadline(signal) {
  const custom = String(signal?.message || "").trim();
  const event = String(signal?.eventName || "NEWS").trim().toUpperCase();
  const symbol = String(signal?.symbol || "").trim().toUpperCase();
  const direction = String(signal?.direction || "").trim().toUpperCase();
  const fallback = `🔥 ${event} NEWS – ${symbol} ${direction} 🔥`;
  if (!custom) return fallback;
  const first = custom.split(/\n+/)[0].trim();
  if (/·|\blot\b|\btrade/i.test(first) && !/🔥|NEWS/i.test(first)) return fallback;
  if (first && first.length <= 72) return first;
  return fallback;
}

function eventMs(event, signal) {
  const fromEvent = Date.parse(event?.at || "");
  if (Number.isFinite(fromEvent)) return fromEvent;
  const fromSignal = Date.parse(signal?.eventAt || "");
  if (Number.isFinite(fromSignal)) return fromSignal;
  return NaN;
}

function executeOpenMs(event, signal) {
  const open = Date.parse(signal?.executeOpensAt || "");
  if (Number.isFinite(open)) return open;
  const at = eventMs(event, signal);
  return Number.isFinite(at) ? at - 20 * 60 * 1000 : Date.parse(signal?.activationAt || "");
}

function canExecuteNow(event, signal, nowMs) {
  if (!signal || signal.executed) return false;
  if (signal.canExecute === true) return true;
  const open = executeOpenMs(event, signal);
  const exp = Date.parse(signal.expirationAt || "");
  if (!Number.isFinite(open)) return signal.status === "active";
  if (nowMs < open) return false;
  if (Number.isFinite(exp) && nowMs >= exp) return false;
  return true;
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
        Y.jsxs("div", { children: ["Lot size: ", signal.lotSize || 0.01] }),
        Y.jsxs("div", { children: ["Trades: ", signal.maxTrades || 1] }),
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

function SignalDirectionCard({ event, signal, mentor, nowMs, onExecute }) {
  const ready = canExecuteNow(event, signal, nowMs);
  const executed = Boolean(signal?.executed);
  const openAt = executeOpenMs(event, signal);
  const newsAt = eventMs(event, signal);
  const opensIn = Number.isFinite(openAt) ? openAt - nowMs : 0;
  const newsClock = Number.isFinite(newsAt) ? formatSastClock(newsAt) : "";
  const direction = String(signal.direction || "").toUpperCase();
  const isSell = direction === "SELL";

  return Y.jsxs("section", {
    className: `ecal-signal${ready ? " is-live" : ""}${executed ? " is-done" : ""}`,
    children: [
      Y.jsxs("div", {
        className: "ecal-signal-top",
        children: [
          Y.jsxs("div", {
            className: "ecal-signal-headcopy",
            children: [
              Y.jsx("p", { className: "ecal-signal-kicker", children: "SIGNAL DIRECTION" }),
              Y.jsxs("p", { className: "ecal-signal-from", children: ["From ", mentor] }),
            ],
          }),
          executed
            ? Y.jsx("span", { className: "ecal-execute is-done", children: "DONE" })
            : ready
              ? Y.jsx("button", {
                  type: "button",
                  className: "ecal-execute",
                  onClick: () => onExecute(signal),
                  children: "EXECUTE",
                })
              : Y.jsx("span", { className: "ecal-execute is-wait", children: "LOCKED" }),
        ],
      }),
      Y.jsx("h3", { className: "ecal-signal-title", children: signalHeadline(signal) }),
      Y.jsxs("ul", {
        className: "ecal-signal-list",
        children: [
          Y.jsxs("li", { children: [Y.jsx("span", { children: isSell ? "📉" : "📈" }), Y.jsxs("strong", { children: ["PAIR: ", signal.symbol] })] }),
          Y.jsxs("li", {
            children: [
              Y.jsx("span", { children: isSell ? "🔴" : "🟢" }),
              Y.jsxs("strong", { className: isSell ? "is-sell" : "is-buy", children: ["DIRECTION: ", direction] }),
            ],
          }),
          Y.jsxs("li", {
            children: [
              Y.jsx("span", { children: "📊" }),
              Y.jsxs("strong", {
                children: [
                  "EVENT: ",
                  String(event?.currency || "US").toUpperCase(),
                  " ",
                  String(event?.name || signal.eventName || "NEWS").toUpperCase(),
                ],
              }),
            ],
          }),
          Y.jsxs("li", {
            children: [
              Y.jsx("span", { children: "⚠️" }),
              Y.jsx("em", { children: "High-impact news. Manage your risk and wait for confirmation before entering." }),
            ],
          }),
        ],
      }),
      Y.jsx("p", { className: "ecal-catch", children: "Let's catch the move! 💰🔥" }),
      executed
        ? Y.jsx("p", { className: "ecal-execute-note", children: "Trade already executed for this signal." })
        : ready
          ? Y.jsx("p", { className: "ecal-execute-note", children: "Execute is open — tap EXECUTE to send the trade." })
          : Y.jsxs("p", {
              className: "ecal-execute-note",
              children: [
                "Execute opens in ",
                formatMinutesLeft(opensIn),
                newsClock ? ` · only from 20 min before ${newsClock}` : " · only from 20 min before the news",
              ],
            }),
    ],
  });
}

function EventDesk({ event, signals, mentor, nowMs, onExecute, isNext }) {
  const list = Array.isArray(signals) ? signals : [];
  const lead = list[0] || null;
  const at = eventMs(event, lead);
  const posted = Date.parse(lead?.publishedAt || lead?.updatedAt || "");
  const mentorName = mentorLabel(lead, mentor);

  return Y.jsxs("article", {
    className: `ecal-event${isNext ? " is-next" : ""}`,
    children: [
      Y.jsxs("div", {
        className: "ecal-event-head",
        children: [
          Y.jsx("p", { className: "ecal-next", children: `NEXT EVENT · ${mentorName.toUpperCase()}` }),
          Y.jsxs("div", {
            className: "ecal-event-title-row",
            children: [
              Y.jsx("h2", { className: "ecal-event-name", children: String(event?.name || lead?.eventName || "EVENT").toUpperCase() }),
              Number.isFinite(posted)
                ? Y.jsxs("div", {
                    className: "ecal-posted",
                    children: [
                      Y.jsx("span", { children: "TIME POSTED" }),
                      Y.jsx("strong", { children: formatSastClock(posted) }),
                    ],
                  })
                : null,
            ],
          }),
          Number.isFinite(at)
            ? Y.jsxs("div", {
                className: "ecal-event-when",
                children: [
                  Y.jsx("p", { children: formatLongDate(at) }),
                  Y.jsxs("p", {
                    children: [
                      formatSastClock(at),
                      " · ",
                      String(event?.name || lead?.eventName || "News"),
                      " release",
                    ],
                  }),
                ],
              })
            : null,
        ],
      }),
      list.length
        ? list.map((signal) =>
            Y.jsx(
              SignalDirectionCard,
              { event, signal, mentor: mentorName, nowMs, onExecute },
              signal.id || `${signal.symbol}-${signal.direction}`,
            ),
          )
        : null,
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
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
      const url = apiUrl(
        `/api/calendar?email=${encodeURIComponent(auth.email)}&licenseKey=${encodeURIComponent(auth.licenseKey)}&v=trapdesk4`,
      );
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: ctrl?.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.error || "Could not load calendar";
        // Still try public news so the desk is not blank while license recovers.
        fetch(apiUrl("/api/calendar/news?v=trapdesk4"), {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: ctrl?.signal,
        })
          .then((newsRes) => newsRes.json().catch(() => ({})))
          .then((news) => {
            if (!news?.ok || !Array.isArray(news.events)) return;
            setData({
              ok: false,
              events: news.events,
              signals: [],
              serverNow: news.serverNow,
            });
          })
          .catch(() => {});
        setError(msg);
        return;
      }
      if (body.serverNowMs) setOffset(body.serverNowMs - Date.now());
      else if (body.serverNow) {
        const server = Date.parse(body.serverNow);
        if (Number.isFinite(server)) setOffset(server - Date.now());
      }
      setData(body);
      setError("");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [auth.email, auth.licenseKey]);

  R.useEffect(() => {
    load().catch((err) => setError(err.message || "Could not load calendar."));
    const tick = setInterval(() => setNowMs(Date.now() + offset), 1000);
    const refresh = setInterval(() => {
      load().catch(() => {});
    }, 20000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [load, offset]);

  R.useEffect(() => {
    setNowMs(Date.now() + offset);
  }, [offset]);

  async function confirmExecute() {
    if (!confirm || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(apiUrl("/api/calendar/execute"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email: auth.email,
          licenseKey: auth.licenseKey,
          signalId: confirm.id,
          mt5Id: auth.mt5Id,
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
  const mentor = mentorLabel(
    { mentorName: data?.license?.botName || auth.mentorName || "Unlimited bull" },
    "Unlimited bull",
  );

  const sameNews = (event, row) => {
    if (!event || !row) return false;
    if (row.eventId && event.id && row.eventId === event.id) return true;
    const name = String(event.name || "").trim().toUpperCase();
    const signalName = String(row.eventName || "").trim().toUpperCase();
    if (!name || name !== signalName) return false;
    return !row.eventDate || !event.date || row.eventDate === event.date;
  };

  const signalsFor = (event) =>
    signals
      .filter((row) => sameNews(event, row))
      .slice()
      .sort((a, b) => {
        const tb = Date.parse(b.updatedAt || b.publishedAt || b.activationAt || 0) || 0;
        const ta = Date.parse(a.updatedAt || a.publishedAt || a.activationAt || 0) || 0;
        return tb - ta;
      });

  const linkedIds = new Set();
  const desks = [];
  for (const event of events) {
    const matched = signalsFor(event);
    matched.forEach((row) => linkedIds.add(row.id));
    // Only pin empty events when they are the imminent next release — no sparse filler list.
    if (!matched.length) {
      const at = Date.parse(event?.at || "");
      if (!Number.isFinite(at) || at < nowMs - 30 * 60 * 1000 || at > nowMs + 36 * 60 * 60 * 1000) continue;
    }
    desks.push({ event, signals: matched });
  }
  const orphan = signals.filter((row) => !linkedIds.has(row.id));
  for (const signal of orphan) {
    desks.push({
      event: {
        id: signal.eventId || signal.id,
        name: signal.eventName,
        at: signal.eventAt || signal.activationAt,
        date: signal.eventDate,
        time: signal.eventTime,
        currency: "USD",
      },
      signals: [signal],
    });
  }

  desks.sort((a, b) => {
    const ta = eventMs(a.event, a.signals[0]) || 0;
    const tb = eventMs(b.event, b.signals[0]) || 0;
    return ta - tb;
  });

  // Prefer signal desks first so CPI cards aren't buried under empty PPI.
  desks.sort((a, b) => {
    const sa = a.signals.length ? 0 : 1;
    const sb = b.signals.length ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const ta = eventMs(a.event, a.signals[0]) || 0;
    const tb = eventMs(b.event, b.signals[0]) || 0;
    return ta - tb;
  });

  const visible = desks.filter((row, index) => row.signals.length || index === 0).slice(0, 3);

  return Y.jsxs("div", {
    className: "calendar-page ecal-page",
    children: [
      Y.jsxs("header", {
        className: "ecal-top",
        children: [
          Y.jsx("h1", { className: "ecal-title", children: "Economic calendar" }),
          Y.jsxs("div", {
            className: "ecal-mentor-pill",
            children: [
              Y.jsx("span", { className: "ecal-mentor-tag", children: "MENTOR" }),
              Y.jsx("strong", { children: mentor }),
            ],
          }),
        ],
      }),
      error && !signals.length
        ? Y.jsx("p", { className: "ecal-error", children: error })
        : null,
      notice ? Y.jsx("p", { className: "ecal-notice", children: notice }) : null,
      visible.length
        ? Y.jsxs("div", {
            className: "ecal-stack",
            children: visible.map(({ event, signals: rows }, index) =>
              Y.jsx(
                EventDesk,
                {
                  event,
                  signals: rows,
                  mentor,
                  nowMs,
                  isNext: index === 0,
                  onExecute: setConfirm,
                },
                event.id || rows[0]?.id || String(index),
              ),
            ),
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
