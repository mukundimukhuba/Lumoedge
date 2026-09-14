import { i as e, t } from "./react-B8IZ02wI.js";
import { n as o } from "./createLucideIcon-DyCq-HOk.js";
import { r as apiUrl } from "./apiBase-CDudBPOx.js";

if (typeof document !== "undefined" && !document.querySelector("link[data-commission-css]")) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/commission-Cw7kQm9A.css";
  link.dataset.commissionCss = "1";
  document.head.appendChild(link);
}

var R = e(t(), 1);
var Y = o();

const SESSION_KEY = "ub-web/admin-session-v1";
const AUTH_KEY = "ub-web/admin-auth-v3";

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readAdmin() {
  const auth = readJson(AUTH_KEY, {});
  return auth?.admin || null;
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

function money(amount, currency = "ZAR") {
  const n = Number(amount) || 0;
  const formatted = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return currency === "ZAR" ? `R${formatted}` : `${currency} ${formatted}`;
}

function when(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function Badge({ status }) {
  const label = String(status || "pending");
  return Y.jsx("span", { className: `commission-badge ${label}`, children: label });
}

function Stat({ value, label }) {
  return Y.jsxs("div", {
    className: "stat-card admin-stat-card",
    children: [
      Y.jsx("div", { className: "admin-stat-value", children: value }),
      Y.jsx("div", { className: "admin-stat-label", children: label }),
    ],
  });
}

function HowItWorks({ amount, currency }) {
  return Y.jsxs("div", {
    className: "glow-card",
    children: [
      Y.jsx("h3", { style: { marginTop: 0 }, children: "How commissions work" }),
      Y.jsxs("ol", {
        className: "commission-steps",
        children: [
          Y.jsx("li", { children: "Create your EA and license key." }),
          Y.jsx("li", { children: "A new client purchases a paid subscription." }),
          Y.jsx("li", { children: "The client activates your license key." }),
          Y.jsx("li", { children: "The system verifies the qualifying subscription." }),
          Y.jsxs("li", {
            children: [
              Y.jsx("strong", { children: money(amount, currency) }),
              " commission is credited to your account.",
            ],
          }),
          Y.jsx("li", {
            children: "After reaching the required number of qualifying subscriptions, you can request a payout.",
          }),
        ],
      }),
    ],
  });
}

function MentorView({ data, onReload, busy, setBusy, setNotice }) {
  const [form, setForm] = R.useState({
    accountHolderName: data.payoutDetails?.accountHolderName || "",
    bankName: data.payoutDetails?.bankName || "",
    accountNumber: "",
    branchCode: data.payoutDetails?.branchCode || "",
    accountType: data.payoutDetails?.accountType || "Cheque",
  });
  R.useEffect(() => {
    setForm((prev) => ({
      ...prev,
      accountHolderName: data.payoutDetails?.accountHolderName || "",
      bankName: data.payoutDetails?.bankName || "",
      branchCode: data.payoutDetails?.branchCode || "",
      accountType: data.payoutDetails?.accountType || prev.accountType || "Cheque",
    }));
  }, [data.payoutDetails]);

  const settings = data.settings || {};
  const totals = data.totals || {};
  const progress = data.progress || {};
  const minimum = Number(progress.minimumQualifyingReferrals || settings.minimumQualifyingReferrals || 0);
  const qualifying = Number(progress.qualifyingReferrals || totals.qualifyingReferrals || 0);
  const pct = minimum > 0 ? Math.min(100, Math.round((qualifying / minimum) * 100)) : 100;

  const saveDetails = async () => {
    setNotice("");
    setBusy("details");
    try {
      await api("/api/commissions/payout-details", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setNotice("Payout details saved. Account number is stored securely and shown masked.");
      setForm((prev) => ({ ...prev, accountNumber: "" }));
      await onReload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save payout details.");
    } finally {
      setBusy("");
    }
  };

  const requestPayout = async () => {
    if (!data.canRequestPayout) return;
    setNotice("");
    setBusy("payout");
    try {
      const result = await api("/api/commissions/payouts", { method: "POST", body: "{}" });
      setNotice(`Withdrawal requested for ${money(result.payout?.amount, settings.currency)}.`);
      await onReload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not request withdrawal.");
    } finally {
      setBusy("");
    }
  };

  return Y.jsxs("div", {
    className: "commission-page",
    children: [
      Y.jsxs("div", {
        children: [
          Y.jsx("p", { className: "commission-kicker", children: "MENTOR COMMISSIONS" }),
          Y.jsx("h2", { className: "commission-title title-blue", children: "Earnings" }),
          Y.jsxs("p", {
            className: "commission-lead",
            children: [
              "Earn ",
              money(settings.commissionPerReferral, settings.currency),
              " for every qualifying first-time paid subscription activated through your license.",
            ],
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "stat-grid admin-stat-grid",
        children: [
          Y.jsx(Stat, { value: money(totals.totalEarned, settings.currency), label: "Total earned" }),
          Y.jsx(Stat, { value: money(totals.available, settings.currency), label: "Available" }),
          Y.jsx(Stat, { value: money(totals.pending, settings.currency), label: "Pending" }),
          Y.jsx(Stat, { value: money(totals.paidOut, settings.currency), label: "Total paid out" }),
          Y.jsx(Stat, { value: String(qualifying), label: "Qualifying referrals" }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Withdrawal progress" }),
          Y.jsxs("p", {
            className: "muted",
            style: { marginTop: 0 },
            children: [qualifying, " / ", minimum],
          }),
          Y.jsx("div", {
            className: "commission-progress",
            children: Y.jsx("span", { style: { width: `${pct}%` } }),
          }),
          Y.jsx("p", { style: { margin: "10px 0 0", fontWeight: 700 }, children: progress.message }),
          data.openPayout
            ? Y.jsxs("p", {
                className: "muted",
                style: { margin: "8px 0 0" },
                children: [
                  "Open payout ",
                  data.openPayout.payoutId,
                  " · ",
                  money(data.openPayout.amount, settings.currency),
                  " · ",
                  data.openPayout.status,
                ],
              })
            : null,
          progress.unlocked
            ? Y.jsx("button", {
                type: "button",
                className: "btn btn-blue",
                style: { marginTop: 12, width: "fit-content" },
                disabled: !data.canRequestPayout || busy === "payout",
                onClick: () => void requestPayout(),
                children: busy === "payout" ? "Requesting…" : "Request withdrawal",
              })
            : null,
          !data.canRequestPayout && data.requestBlockedReason && progress.unlocked
            ? Y.jsx("p", { className: "muted", style: { margin: "8px 0 0", fontSize: 12 }, children: data.requestBlockedReason })
            : null,
        ],
      }),
      Y.jsx(HowItWorks, { amount: settings.commissionPerReferral, currency: settings.currency }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Payout details" }),
          Y.jsx("p", {
            className: "muted",
            style: { marginTop: 0 },
            children: "Used only for withdrawals. The full account number is never shown again after saving.",
          }),
          data.payoutDetails?.accountNumberMasked
            ? Y.jsxs("p", {
                className: "muted",
                children: ["Saved account: ", data.payoutDetails.accountNumberMasked],
              })
            : null,
          Y.jsxs("div", {
            className: "field",
            children: [
              Y.jsx("label", { children: "Account holder name" }),
              Y.jsx("input", {
                value: form.accountHolderName,
                onChange: (ev) => setForm({ ...form, accountHolderName: ev.target.value }),
              }),
            ],
          }),
          Y.jsxs("div", {
            className: "field",
            children: [
              Y.jsx("label", { children: "Bank name" }),
              Y.jsx("input", {
                value: form.bankName,
                onChange: (ev) => setForm({ ...form, bankName: ev.target.value }),
              }),
            ],
          }),
          Y.jsxs("div", {
            className: "field",
            children: [
              Y.jsx("label", { children: "Account number" }),
              Y.jsx("input", {
                value: form.accountNumber,
                onChange: (ev) => setForm({ ...form, accountNumber: ev.target.value }),
                placeholder: data.payoutDetails?.accountNumberMasked || "Enter account number",
                autoComplete: "off",
              }),
            ],
          }),
          Y.jsxs("div", {
            className: "field",
            children: [
              Y.jsx("label", { children: "Branch code" }),
              Y.jsx("input", {
                value: form.branchCode,
                onChange: (ev) => setForm({ ...form, branchCode: ev.target.value }),
              }),
            ],
          }),
          Y.jsxs("div", {
            className: "field",
            children: [
              Y.jsx("label", { children: "Account type" }),
              Y.jsxs("select", {
                value: form.accountType,
                onChange: (ev) => setForm({ ...form, accountType: ev.target.value }),
                children: [
                  Y.jsx("option", { children: "Cheque" }),
                  Y.jsx("option", { children: "Savings" }),
                  Y.jsx("option", { children: "Transmission" }),
                ],
              }),
            ],
          }),
          Y.jsx("button", {
            type: "button",
            className: "btn btn-blue",
            disabled: busy === "details",
            onClick: () => void saveDetails(),
            children: busy === "details" ? "Saving…" : "Save payout details",
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Commission activity" }),
          !data.commissions?.length
            ? Y.jsx("p", {
                className: "commission-empty",
                children: "No qualifying commissions yet. Earnings appear after a new client pays and activates your license.",
              })
            : Y.jsx("div", {
                className: "commission-table-wrap",
                children: Y.jsxs("table", {
                  className: "commission-table",
                  children: [
                    Y.jsx("thead", {
                      children: Y.jsxs("tr", {
                        children: [
                          Y.jsx("th", { children: "Client ref" }),
                          Y.jsx("th", { children: "Mentor / EA" }),
                          Y.jsx("th", { children: "License" }),
                          Y.jsx("th", { children: "Payment" }),
                          Y.jsx("th", { children: "Amount" }),
                          Y.jsx("th", { children: "Date" }),
                          Y.jsx("th", { children: "Status" }),
                        ],
                      }),
                    }),
                    Y.jsx("tbody", {
                      children: data.commissions.map((row) =>
                        Y.jsxs(
                          "tr",
                          {
                            children: [
                              Y.jsx("td", { children: row.clientRef || row.eventId }),
                              Y.jsx("td", { children: row.eaName || row.mentorId || "—" }),
                              Y.jsx("td", { children: row.licenseKeyRef || "—" }),
                              Y.jsx("td", { children: row.paymentRef || "—" }),
                              Y.jsx("td", { children: money(row.amount, row.currency || settings.currency) }),
                              Y.jsx("td", { children: when(row.createdAt) }),
                              Y.jsx("td", { children: Y.jsx(Badge, { status: row.status }) }),
                            ],
                          },
                          row.eventId,
                        ),
                      ),
                    }),
                  ],
                }),
              }),
        ],
      }),
    ],
  });
}

function SuperView({ admin, onNotice }) {
  const [overview, setOverview] = R.useState(null);
  const [filters, setFilters] = R.useState({ mentor: "", reference: "", status: "", from: "", to: "" });
  const [settingsForm, setSettingsForm] = R.useState(null);
  const [adjust, setAdjust] = R.useState({ mentorId: "", amount: "50", reason: "" });
  const [busy, setBusy] = R.useState("");

  const load = async (nextFilters = filters) => {
    const q = new URLSearchParams();
    if (nextFilters.mentor) q.set("mentor", nextFilters.mentor);
    if (nextFilters.reference) q.set("reference", nextFilters.reference);
    if (nextFilters.status) q.set("status", nextFilters.status);
    if (nextFilters.from) q.set("from", nextFilters.from);
    if (nextFilters.to) q.set("to", nextFilters.to);
    const data = await api(`/api/commissions/admin?${q.toString()}`);
    setOverview(data);
    setSettingsForm(data.settings);
  };

  R.useEffect(() => {
    load().catch((err) => onNotice(err instanceof Error ? err.message : "Could not load admin commissions."));
  }, []);

  const act = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      await load();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy("");
    }
  };

  if (!overview || !settingsForm) {
    return Y.jsx("p", { className: "muted", children: "Loading commission management…" });
  }

  return Y.jsxs("div", {
    className: "commission-page",
    children: [
      Y.jsxs("div", {
        children: [
          Y.jsx("p", { className: "commission-kicker", children: "SUPER ADMIN" }),
          Y.jsx("h2", { className: "commission-title title-blue", children: "Commission management" }),
        ],
      }),
      Y.jsxs("div", {
        className: "stat-grid admin-stat-grid",
        children: [
          Y.jsx(Stat, { value: money(overview.totals.totalEarned, overview.settings.currency), label: "Total commissions" }),
          Y.jsx(Stat, { value: money(overview.totals.pending, overview.settings.currency), label: "Pending" }),
          Y.jsx(Stat, { value: money(overview.totals.available, overview.settings.currency), label: "Available" }),
          Y.jsx(Stat, { value: money(overview.totals.paidOut, overview.settings.currency), label: "Paid" }),
          Y.jsx(Stat, { value: String(overview.totals.qualifyingReferrals), label: "Qualifying referrals" }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Commission settings" }),
          Y.jsxs("div", {
            className: "commission-filters",
            children: [
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "Commission per referral" }),
                  Y.jsx("input", {
                    type: "number",
                    value: settingsForm.commissionPerReferral,
                    onChange: (ev) =>
                      setSettingsForm({ ...settingsForm, commissionPerReferral: Number(ev.target.value) }),
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "Minimum qualifying referrals" }),
                  Y.jsx("input", {
                    type: "number",
                    value: settingsForm.minimumQualifyingReferrals,
                    onChange: (ev) =>
                      setSettingsForm({
                        ...settingsForm,
                        minimumQualifyingReferrals: Number(ev.target.value),
                      }),
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "Withdrawals" }),
                  Y.jsxs("select", {
                    value: String(settingsForm.withdrawalEnabled !== false),
                    onChange: (ev) =>
                      setSettingsForm({ ...settingsForm, withdrawalEnabled: ev.target.value === "true" }),
                    children: [
                      Y.jsx("option", { value: "true", children: "Enabled" }),
                      Y.jsx("option", { value: "false", children: "Paused" }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          Y.jsx("button", {
            type: "button",
            className: "btn btn-blue",
            style: { marginTop: 8, width: "fit-content" },
            disabled: busy === "settings",
            onClick: () =>
              void act("settings", async () => {
                await api("/api/commissions/settings", {
                  method: "PUT",
                  body: JSON.stringify(settingsForm),
                });
                onNotice("Commission settings saved. Future commissions use the new amount.");
              }),
            children: busy === "settings" ? "Saving…" : "Save settings",
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Search and filters" }),
          Y.jsxs("div", {
            className: "commission-filters",
            children: [
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "Mentor" }),
                  Y.jsx("input", {
                    value: filters.mentor,
                    onChange: (ev) => setFilters({ ...filters, mentor: ev.target.value }),
                    placeholder: "ID, name, email",
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "Transaction / reference" }),
                  Y.jsx("input", {
                    value: filters.reference,
                    onChange: (ev) => setFilters({ ...filters, reference: ev.target.value }),
                    placeholder: "event, payout, license",
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "Status" }),
                  Y.jsxs("select", {
                    value: filters.status,
                    onChange: (ev) => setFilters({ ...filters, status: ev.target.value }),
                    children: ["", "pending", "available", "paid", "reversed", "rejected", "requested", "approved"].map(
                      (value) => Y.jsx("option", { value, children: value || "All" }, value || "all"),
                    ),
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "From" }),
                  Y.jsx("input", {
                    type: "date",
                    value: filters.from,
                    onChange: (ev) => setFilters({ ...filters, from: ev.target.value }),
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "To" }),
                  Y.jsx("input", {
                    type: "date",
                    value: filters.to,
                    onChange: (ev) => setFilters({ ...filters, to: ev.target.value }),
                  }),
                ],
              }),
            ],
          }),
          Y.jsx("button", {
            type: "button",
            className: "btn btn-ghost",
            onClick: () => void load(filters).catch((err) => onNotice(err.message)),
            children: "Apply filters",
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Mentors" }),
          Y.jsx("div", {
            className: "commission-table-wrap",
            children: Y.jsxs("table", {
              className: "commission-table",
              children: [
                Y.jsx("thead", {
                  children: Y.jsxs("tr", {
                    children: [
                      Y.jsx("th", { children: "Mentor" }),
                      Y.jsx("th", { children: "Total" }),
                      Y.jsx("th", { children: "Pending" }),
                      Y.jsx("th", { children: "Available" }),
                      Y.jsx("th", { children: "Paid" }),
                      Y.jsx("th", { children: "Referrals" }),
                      Y.jsx("th", { children: "Payout" }),
                    ],
                  }),
                }),
                Y.jsx("tbody", {
                  children: (overview.mentors || []).map((row) =>
                    Y.jsxs(
                      "tr",
                      {
                        children: [
                          Y.jsxs("td", {
                            children: [
                              Y.jsx("strong", { children: row.fullName || row.mentorId }),
                              Y.jsx("div", { className: "muted", children: row.mentorId }),
                              row.payoutDetails
                                ? Y.jsxs("div", {
                                    className: "muted",
                                    children: [
                                      row.payoutDetails.bankName,
                                      " ",
                                      row.payoutDetails.accountNumberMasked || "",
                                    ],
                                  })
                                : Y.jsx("div", { className: "muted", children: "No payout details" }),
                            ],
                          }),
                          Y.jsx("td", { children: money(row.totals.totalEarned, overview.settings.currency) }),
                          Y.jsx("td", { children: money(row.totals.pending, overview.settings.currency) }),
                          Y.jsx("td", { children: money(row.totals.available, overview.settings.currency) }),
                          Y.jsx("td", { children: money(row.totals.paidOut, overview.settings.currency) }),
                          Y.jsx("td", { children: row.totals.qualifyingReferrals }),
                          Y.jsx("td", {
                            children: row.openPayout
                              ? Y.jsx(Badge, { status: row.openPayout.status })
                              : row.progress?.unlocked
                                ? "Unlocked"
                                : row.progress?.message,
                          }),
                        ],
                      },
                      row.mentorId,
                    ),
                  ),
                }),
              ],
            }),
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Payout requests" }),
          !(overview.payouts || []).length
            ? Y.jsx("p", { className: "muted", children: "No payout requests yet." })
            : (overview.payouts || []).map((row) =>
                Y.jsxs(
                  "div",
                  {
                    style: { padding: "10px 0", borderTop: "1px solid rgba(255,255,255,.08)" },
                    children: [
                      Y.jsxs("strong", { children: [row.payoutId, " · ", money(row.amount, overview.settings.currency)] }),
                      Y.jsxs("div", { className: "muted", children: [row.mentorId, " · ", when(row.requestedAt)] }),
                      Y.jsx(Badge, { status: row.status }),
                      row.payoutDetails
                        ? Y.jsxs("div", {
                            className: "muted",
                            children: [
                              row.payoutDetails.accountHolderName,
                              " · ",
                              row.payoutDetails.bankName,
                              " · ",
                              row.payoutDetails.accountNumberMasked,
                            ],
                          })
                        : null,
                      Y.jsxs("div", {
                        className: "commission-actions",
                        style: { marginTop: 8 },
                        children: [
                          Y.jsx("button", {
                            type: "button",
                            className: "btn btn-ghost",
                            disabled: busy !== "",
                            onClick: () =>
                              void act("approve", () =>
                                api(`/api/commissions/admin/payouts/${row.payoutId}/approve`, {
                                  method: "POST",
                                  body: "{}",
                                }),
                              ),
                            children: "Approve",
                          }),
                          Y.jsx("button", {
                            type: "button",
                            className: "btn btn-blue",
                            disabled: busy !== "",
                            onClick: () =>
                              void act("paid", () =>
                                api(`/api/commissions/admin/payouts/${row.payoutId}/paid`, {
                                  method: "POST",
                                  body: "{}",
                                }),
                              ),
                            children: "Mark paid",
                          }),
                          Y.jsx("button", {
                            type: "button",
                            className: "btn btn-ghost",
                            style: { borderColor: "var(--red)", color: "var(--red)" },
                            disabled: busy !== "",
                            onClick: () => {
                              const reason = window.prompt("Reason for rejecting this payout?");
                              if (!reason) return;
                              return act("reject", () =>
                                api(`/api/commissions/admin/payouts/${row.payoutId}/reject`, {
                                  method: "POST",
                                  body: JSON.stringify({ reason }),
                                }),
                              );
                            },
                            children: "Reject",
                          }),
                        ],
                      }),
                    ],
                  },
                  row.payoutId,
                ),
              ),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Commission history" }),
          Y.jsx("div", {
            className: "commission-table-wrap",
            children: Y.jsxs("table", {
              className: "commission-table",
              children: [
                Y.jsx("thead", {
                  children: Y.jsxs("tr", {
                    children: [
                      Y.jsx("th", { children: "Event" }),
                      Y.jsx("th", { children: "Mentor" }),
                      Y.jsx("th", { children: "Client / license" }),
                      Y.jsx("th", { children: "Amount" }),
                      Y.jsx("th", { children: "Date" }),
                      Y.jsx("th", { children: "Status" }),
                      Y.jsx("th", { children: "" }),
                    ],
                  }),
                }),
                Y.jsx("tbody", {
                  children: (overview.commissions || []).map((row) =>
                    Y.jsxs(
                      "tr",
                      {
                        children: [
                          Y.jsx("td", { children: row.eventId }),
                          Y.jsx("td", { children: row.mentorId }),
                          Y.jsxs("td", {
                            children: [row.clientRef, " · ", row.licenseKeyRef || row.eaName || "—"],
                          }),
                          Y.jsx("td", { children: money(row.amount, row.currency) }),
                          Y.jsx("td", { children: when(row.createdAt) }),
                          Y.jsx("td", { children: Y.jsx(Badge, { status: row.status }) }),
                          Y.jsx("td", {
                            children:
                              row.status === "reversed"
                                ? null
                                : Y.jsx("button", {
                                    type: "button",
                                    className: "btn btn-ghost",
                                    onClick: () => {
                                      const reason = window.prompt("Reason for reversing this commission?");
                                      if (!reason) return;
                                      return act("reverse", () =>
                                        api("/api/commissions/admin/reverse", {
                                          method: "POST",
                                          body: JSON.stringify({ eventId: row.eventId, reason }),
                                        }),
                                      );
                                    },
                                    children: "Reverse",
                                  }),
                          }),
                        ],
                      },
                      row.eventId,
                    ),
                  ),
                }),
              ],
            }),
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Manual adjustment" }),
          Y.jsx("p", { className: "muted", style: { marginTop: 0 }, children: "A reason is required. The amount is stored on this record and does not rewrite history." }),
          Y.jsxs("div", {
            className: "commission-filters",
            children: [
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "Mentor ID" }),
                  Y.jsx("input", {
                    value: adjust.mentorId,
                    onChange: (ev) => setAdjust({ ...adjust, mentorId: ev.target.value }),
                    placeholder: admin?.id || "LM-xxxxxx",
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "Amount" }),
                  Y.jsx("input", {
                    value: adjust.amount,
                    onChange: (ev) => setAdjust({ ...adjust, amount: ev.target.value }),
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "field",
                children: [
                  Y.jsx("label", { children: "Reason" }),
                  Y.jsx("input", {
                    value: adjust.reason,
                    onChange: (ev) => setAdjust({ ...adjust, reason: ev.target.value }),
                  }),
                ],
              }),
            ],
          }),
          Y.jsx("button", {
            type: "button",
            className: "btn btn-blue",
            disabled: busy === "adjust",
            onClick: () =>
              void act("adjust", async () => {
                await api("/api/commissions/admin/adjust", {
                  method: "POST",
                  body: JSON.stringify(adjust),
                });
                onNotice("Manual adjustment recorded.");
                setAdjust({ ...adjust, reason: "" });
              }),
            children: busy === "adjust" ? "Saving…" : "Add adjustment",
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Audit trail" }),
          !(overview.audit || []).length
            ? Y.jsx("p", { className: "muted", children: "No commission audit events yet." })
            : (overview.audit || []).slice(0, 40).map((row) =>
                Y.jsxs(
                  "div",
                  {
                    style: { padding: "8px 0", borderTop: "1px solid rgba(255,255,255,.06)", fontSize: 12 },
                    children: [
                      Y.jsx("strong", { children: row.action }),
                      Y.jsxs("div", {
                        className: "muted",
                        children: [when(row.timestamp), " · ", row.actorId, row.reason ? ` · ${row.reason}` : ""],
                      }),
                    ],
                  },
                  row.id,
                ),
              ),
        ],
      }),
    ],
  });
}

function CommissionsPage() {
  const admin = readAdmin();
  const isSuper = admin?.role === "super";
  const [data, setData] = R.useState(null);
  const [error, setError] = R.useState("");
  const [notice, setNotice] = R.useState("");
  const [busy, setBusy] = R.useState("");
  const [tab, setTab] = R.useState(isSuper ? "admin" : "mentor");

  const reload = async () => {
    const me = await api("/api/commissions/me");
    setData(me);
  };

  R.useEffect(() => {
    reload().catch((err) => {
      if (err.status === 401) setError("Sign in again to load commissions.");
      else setError(err instanceof Error ? err.message : "Could not load commissions.");
    });
  }, []);

  return Y.jsxs("div", {
    className: "commission-page",
    children: [
      isSuper
        ? Y.jsxs("div", {
            className: "commission-actions",
            children: [
              Y.jsx("button", {
                type: "button",
                className: tab === "mentor" ? "btn btn-blue" : "btn btn-ghost",
                onClick: () => setTab("mentor"),
                children: "My earnings",
              }),
              Y.jsx("button", {
                type: "button",
                className: tab === "admin" ? "btn btn-blue" : "btn btn-ghost",
                onClick: () => setTab("admin"),
                children: "Manage all",
              }),
            ],
          })
        : null,
      error ? Y.jsx("p", { className: "error", children: error }) : null,
      notice ? Y.jsx("p", { style: { margin: 0, color: "var(--green)", fontWeight: 700 }, children: notice }) : null,
      tab === "admin" && isSuper
        ? Y.jsx(SuperView, { admin, onNotice: setNotice })
        : data
          ? Y.jsx(MentorView, { data, onReload: reload, busy, setBusy, setNotice })
          : error
            ? null
            : Y.jsx("p", { className: "muted", children: "Loading commissions…" }),
    ],
  });
}

export { CommissionsPage, CommissionsPage as default };
