import { i as e, t } from "./react-B8IZ02wI.js";
import { n as o } from "./createLucideIcon-DyCq-HOk.js";
import { r as apiUrl } from "./apiBase-CDudBPOx.js";

if (typeof document !== "undefined" && !document.querySelector("link[data-commission-css]")) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/commission-Cw7kQm9B.css";
  link.dataset.commissionCss = "1";
  document.head.appendChild(link);
}

var R = e(t(), 1);
var Y = o();

const SESSION_KEY = "ub-web/admin-session-v1";
const AUTH_KEY = "ub-web/admin-auth-v3";
const FILTERS = [
  ["all", "All"],
  ["mentors", "Mentors"],
  ["admins", "Admins"],
  ["active", "Active"],
  ["inactive", "Inactive"],
  ["highest earners", "Highest Earners"],
  ["pending payouts", "Pending Payouts"],
];

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

function Field({ label, children }) {
  return Y.jsxs("div", { className: "field", children: [Y.jsx("label", { children: label }), children] });
}

function HowItWorks({ amount, currency }) {
  return Y.jsxs("div", {
    className: "glow-card",
    children: [
      Y.jsx("h3", { style: { marginTop: 0 }, children: "How commissions work" }),
      Y.jsxs("ol", {
        className: "commission-steps",
        children: [
          Y.jsx("li", { children: "Join the commission program and wait for Super Admin approval if required." }),
          Y.jsx("li", { children: "Create your EA and license key." }),
          Y.jsx("li", { children: "A new client purchases a paid subscription through your referral." }),
          Y.jsx("li", { children: "The client activates your license key." }),
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

function HistoryTable({ rows, currency, empty, canEdit, busy, onEditAmount }) {
  if (!rows?.length) {
    return Y.jsx("p", { className: "commission-empty", children: empty });
  }
  return Y.jsx("div", {
    className: "commission-table-wrap",
    children: Y.jsxs("table", {
      className: "commission-table",
      children: [
        Y.jsx("thead", {
          children: Y.jsxs("tr", {
            children: [
              Y.jsx("th", { children: "Date" }),
              Y.jsx("th", { children: "Client" }),
              Y.jsx("th", { children: "Subscription amount" }),
              Y.jsx("th", { children: "Commission earned" }),
              Y.jsx("th", { children: "Status" }),
              canEdit ? Y.jsx("th", { children: "Edit" }) : null,
            ],
          }),
        }),
        Y.jsx("tbody", {
          children: rows.map((row) =>
            Y.jsxs(
              "tr",
              {
                children: [
                  Y.jsx("td", { children: when(row.createdAt) }),
                  Y.jsx("td", { children: row.clientName || row.clientRef || "—" }),
                  Y.jsx("td", {
                    children: row.subscriptionAmount
                      ? money(row.subscriptionAmount, row.currency || currency)
                      : "—",
                  }),
                  Y.jsx("td", { children: money(row.amount, row.currency || currency) }),
                  Y.jsx("td", { children: Y.jsx(Badge, { status: row.status }) }),
                  canEdit
                    ? Y.jsx("td", {
                        children:
                          row.status === "reversed" || row.status === "rejected"
                            ? Y.jsx("span", { className: "muted", children: "Locked" })
                            : Y.jsx("button", {
                                type: "button",
                                className: "btn btn-ghost",
                                disabled: Boolean(busy),
                                onClick: () => onEditAmount?.(row),
                                children: "Edit amount",
                              }),
                      })
                    : null,
                ],
              },
              row.eventId,
            ),
          ),
        }),
      ],
    }),
  });
}

function JoinForm({ admin, enrollment, onReload, setNotice, busy, setBusy }) {
  const mentorName = String(
    admin?.mentorName || enrollment?.mentorName || enrollment?.fullName || admin?.fullName || "",
  ).trim();
  const [form, setForm] = R.useState({
    mentorName,
    email: admin?.email || enrollment?.email || "",
    phone: admin?.phone || enrollment?.phone || "",
    adminId: admin?.id || "",
    source: "",
    acceptTerms: false,
  });

  const submit = async () => {
    setNotice("");
    setBusy("join");
    try {
      await api("/api/commissions/join", {
        method: "POST",
        body: JSON.stringify({
          mentorName: form.mentorName,
          email: form.email,
          phone: form.phone,
          phoneNumber: form.phone,
          adminId: form.adminId,
          source: form.source,
          referralSource: form.source,
          acceptTerms: form.acceptTerms,
        }),
      });
      setNotice("Application submitted. Super Admin will approve or reject it. Your system role is unchanged.");
      await onReload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not submit application.");
    } finally {
      setBusy("");
    }
  };

  return Y.jsxs("div", {
    className: "glow-card",
    children: [
      Y.jsx("h3", { style: { marginTop: 0 }, children: "Join Commission Program" }),
      Y.jsx("p", {
        className: "muted",
        style: { marginTop: 0 },
        children:
          "Apply with your mentor name. Joining does not grant Super Admin permissions.",
      }),
      Y.jsxs("div", {
        className: "commission-filters",
        children: [
          Y.jsx(Field, {
            label: "Mentor name",
            children: Y.jsx("input", {
              value: form.mentorName,
              onChange: (ev) => setForm({ ...form, mentorName: ev.target.value }),
            }),
          }),
          Y.jsx(Field, {
            label: "Email",
            children: Y.jsx("input", {
              value: form.email,
              onChange: (ev) => setForm({ ...form, email: ev.target.value }),
            }),
          }),
          Y.jsx(Field, {
            label: "Phone Number",
            children: Y.jsx("input", {
              value: form.phone,
              onChange: (ev) => setForm({ ...form, phone: ev.target.value }),
            }),
          }),
          Y.jsx(Field, {
            label: "Admin ID",
            children: Y.jsx("input", { value: form.adminId, readOnly: true }),
          }),
          Y.jsx(Field, {
            label: "Referral / source (optional)",
            children: Y.jsx("input", {
              value: form.source,
              onChange: (ev) => setForm({ ...form, source: ev.target.value }),
              placeholder: "Optional",
            }),
          }),
        ],
      }),
      Y.jsxs("label", {
        className: "commission-check",
        style: { marginTop: 12 },
        children: [
          Y.jsx("input", {
            type: "checkbox",
            checked: form.acceptTerms,
            onChange: (ev) => setForm({ ...form, acceptTerms: ev.target.checked }),
          }),
          Y.jsx("span", { children: "I accept the Commission Program Terms" }),
        ],
      }),
      Y.jsx("button", {
        type: "button",
        className: "btn btn-blue",
        style: { marginTop: 12, width: "fit-content" },
        disabled: busy === "join" || !form.acceptTerms,
        onClick: () => void submit(),
        children: busy === "join" ? "Submitting…" : "Start Earning",
      }),
    ],
  });
}

function MentorView({ data, admin, onReload, busy, setBusy, setNotice }) {
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
  const enrollment = data.enrollment || {};
  const minimum = Number(progress.minimumQualifyingReferrals || settings.minimumQualifyingReferrals || 0);
  const qualifying = Number(progress.qualifyingReferrals || totals.qualifyingReferrals || 0);
  const pct = minimum > 0 ? Math.min(100, Math.round((qualifying / minimum) * 100)) : 100;
  const status = enrollment.status || "none";

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
          Y.jsx("p", { className: "commission-kicker", children: "MY EARNINGS" }),
          Y.jsx("h2", { className: "commission-title title-blue", children: "Personal commissions" }),
          Y.jsxs("p", {
            className: "commission-lead",
            children: [
              "Your own totals only. Earn ",
              money(enrollment.rate || settings.commissionPerReferral, settings.currency),
              " for every qualifying first-time paid subscription referred through your license.",
            ],
          }),
        ],
      }),
      status === "pending"
        ? Y.jsx("div", {
            className: "commission-banner",
            children: "Your commission application is pending Super Admin approval. You cannot earn until the status is Active.",
          })
        : null,
      status === "inactive"
        ? Y.jsx("div", {
            className: "commission-banner",
            children: "Your commission account is inactive. Super Admin can reactivate it. This does not change your admin permissions.",
          })
        : null,
      status === "rejected"
        ? Y.jsx("div", {
            className: "commission-banner",
            children: "Your previous application was rejected. You can apply again below.",
          })
        : null,
      enrollment.canJoin ? Y.jsx(JoinForm, { admin, enrollment, onReload, setNotice, busy, setBusy }) : null,
      Y.jsxs("div", {
        className: "stat-grid admin-stat-grid",
        children: [
          Y.jsx(Stat, { value: money(totals.totalEarned, settings.currency), label: "Total earnings" }),
          Y.jsx(Stat, { value: money(totals.paidOut, settings.currency), label: "Paid earnings" }),
          Y.jsx(Stat, { value: money(totals.pending, settings.currency), label: "Pending earnings" }),
          Y.jsx(Stat, {
            value: String(qualifying),
            label: "Successful referrals / subscriptions",
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Withdrawal progress" }),
          Y.jsxs("p", { className: "muted", style: { marginTop: 0 }, children: [qualifying, " / ", minimum] }),
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
      Y.jsx(HowItWorks, { amount: enrollment.rate || settings.commissionPerReferral, currency: settings.currency }),
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
          Y.jsx(Field, {
            label: "Account holder name",
            children: Y.jsx("input", {
              value: form.accountHolderName,
              onChange: (ev) => setForm({ ...form, accountHolderName: ev.target.value }),
            }),
          }),
          Y.jsx(Field, {
            label: "Bank name",
            children: Y.jsx("input", {
              value: form.bankName,
              onChange: (ev) => setForm({ ...form, bankName: ev.target.value }),
            }),
          }),
          Y.jsx(Field, {
            label: "Account number",
            children: Y.jsx("input", {
              value: form.accountNumber,
              onChange: (ev) => setForm({ ...form, accountNumber: ev.target.value }),
              placeholder: data.payoutDetails?.accountNumberMasked || "Enter account number",
              autoComplete: "off",
            }),
          }),
          Y.jsx(Field, {
            label: "Branch code",
            children: Y.jsx("input", {
              value: form.branchCode,
              onChange: (ev) => setForm({ ...form, branchCode: ev.target.value }),
            }),
          }),
          Y.jsx(Field, {
            label: "Account type",
            children: Y.jsxs("select", {
              value: form.accountType,
              onChange: (ev) => setForm({ ...form, accountType: ev.target.value }),
              children: [
                Y.jsx("option", { children: "Cheque" }),
                Y.jsx("option", { children: "Savings" }),
                Y.jsx("option", { children: "Transmission" }),
              ],
            }),
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
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Commission history" }),
          Y.jsx(HistoryTable, {
            rows: data.commissions,
            currency: settings.currency,
            empty: "No qualifying commissions yet. Earnings appear after a new client pays and activates your license.",
          }),
        ],
      }),
    ],
  });
}

function RestrictedManageAll() {
  return Y.jsxs("div", {
    className: "glow-card",
    children: [
      Y.jsx("p", { className: "commission-kicker", children: "MANAGE ALL" }),
      Y.jsx("h2", { className: "commission-title title-blue", children: "Commission management" }),
      Y.jsx("p", {
        className: "commission-restricted",
        children:
          "Platform-wide commission management is reserved for Super Admin. Other people’s earnings stay private. Use My Earnings for your own totals, history, and commission program signup.",
      }),
    ],
  });
}

function RankCard({ row, currency, selected, onOpen }) {
  return Y.jsxs("article", {
    className: `commission-rank-card${selected ? " is-open" : ""}`,
    children: [
      Y.jsxs("div", { className: "commission-rank-num", children: ["#", row.rank] }),
      Y.jsxs("div", {
        className: "commission-rank-meta",
        children: [
          Y.jsxs("strong", { children: ["Name: ", row.fullName || row.mentorId] }),
          Y.jsxs("div", {
            className: "commission-rank-grid",
            children: [
              Y.jsxs("span", {
                children: ["Total Earnings: ", Y.jsx("b", { children: money(row.totals?.totalEarned, currency) })],
              }),
              Y.jsxs("span", { children: ["Referrals: ", Y.jsx("b", { children: String(row.referrals || 0) })] }),
              Y.jsxs("span", {
                children: ["Paid: ", Y.jsx("b", { children: money(row.totals?.paidOut, currency) })],
              }),
              Y.jsxs("span", {
                children: ["Pending: ", Y.jsx("b", { children: money(row.totals?.pending, currency) })],
              }),
              Y.jsxs("span", {
                children: ["Rate: ", Y.jsx("b", { children: money(row.rate, currency) })],
              }),
            ],
          }),
          Y.jsxs("div", {
            className: "commission-actions",
            style: { marginTop: 8 },
            children: [
              Y.jsx(Badge, { status: row.status }),
              Y.jsx(Badge, { status: row.accountType }),
              Y.jsx("span", { className: "muted", children: row.mentorId }),
              Y.jsx("button", {
                type: "button",
                className: selected ? "btn btn-blue" : "btn btn-ghost",
                onClick: () => onOpen(row),
                children: selected ? "Editing" : "Edit commission",
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function SuperView({ admin, onNotice }) {
  const [overview, setOverview] = R.useState(null);
  const [search, setSearch] = R.useState("");
  const [filter, setFilter] = R.useState("all");
  const [settingsForm, setSettingsForm] = R.useState(null);
  const [adjust, setAdjust] = R.useState({ mentorId: "", amount: "50", reason: "" });
  const [rateForm, setRateForm] = R.useState("");
  const [profile, setProfile] = R.useState(null);
  const [busy, setBusy] = R.useState("");

  const load = async (nextFilter = filter, nextSearch = search) => {
    const q = new URLSearchParams();
    if (nextSearch) q.set("q", nextSearch);
    if (nextFilter && nextFilter !== "all") q.set("filter", nextFilter);
    const data = await api(`/api/commissions/admin?${q.toString()}`);
    setOverview(data);
    setSettingsForm(data.settings);
    return data;
  };

  R.useEffect(() => {
    load().catch((err) => onNotice(err instanceof Error ? err.message : "Could not load admin commissions."));
  }, []);

  const act = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      const data = await load();
      if (profile?.mentorId) {
        const next = await api(`/api/commissions/admin/mentors/${encodeURIComponent(profile.mentorId)}`);
        setProfile(next.profile);
      }
      return data;
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy("");
    }
  };

  const openProfile = async (row) => {
    setBusy("profile");
    try {
      const next = await api(`/api/commissions/admin/mentors/${encodeURIComponent(row.mentorId)}`);
      setProfile(next.profile);
      setRateForm(String(next.profile?.rate ?? ""));
      setAdjust((prev) => ({ ...prev, mentorId: next.profile?.mentorId || row.mentorId }));
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Could not load profile.");
    } finally {
      setBusy("");
    }
  };

  const editCommissionAmount = (row) => {
    const nextAmount = window.prompt(
      `New commission amount for ${row.clientName || row.eventId}`,
      String(row.amount ?? ""),
    );
    if (nextAmount == null || String(nextAmount).trim() === "") return;
    const reason = window.prompt("Reason for editing this person's commission?");
    if (!reason) return;
    return act("editAmount", async () => {
      await api(`/api/commissions/admin/commissions/${encodeURIComponent(row.eventId)}`, {
        method: "PUT",
        body: JSON.stringify({ amount: Number(nextAmount), reason }),
      });
      onNotice("Commission amount updated.");
    });
  };

  if (!overview || !settingsForm) {
    return Y.jsx("p", { className: "muted", children: "Loading commission management…" });
  }

  const currency = overview.settings.currency;
  const dash = overview.dashboard || {};
  const earners = overview.earners || overview.mentors || [];

  return Y.jsxs("div", {
    className: "commission-page",
    children: [
      Y.jsxs("div", {
        children: [
          Y.jsx("p", { className: "commission-kicker", children: "SUPER ADMIN" }),
          Y.jsx("h2", { className: "commission-title title-blue", children: "Manage all earners" }),
          Y.jsx("p", {
            className: "commission-lead",
            children: "Everyone enrolled in the commission program, ranked by highest total earnings first. Rankings update whenever a commission or payout changes.",
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "stat-grid admin-stat-grid",
        children: [
          Y.jsx(Stat, { value: String(dash.totalEarners || 0), label: "Total Commission Earners" }),
          Y.jsx(Stat, {
            value: money(dash.totalCommissionsGenerated || 0, currency),
            label: "Total Commissions Generated",
          }),
          Y.jsx(Stat, { value: money(dash.totalPaid || 0, currency), label: "Total Paid" }),
          Y.jsx(Stat, { value: money(dash.totalPending || 0, currency), label: "Total Pending" }),
          Y.jsx(Stat, {
            value: dash.topEarner
              ? `${dash.topEarner.fullName} · ${money(dash.topEarner.totalEarned, currency)}`
              : "—",
            label: "Top Earner",
          }),
        ],
      }),
      (overview.applications || []).length
        ? Y.jsxs("div", {
            className: "glow-card",
            children: [
              Y.jsx("h3", { style: { marginTop: 0 }, children: "Pending applications" }),
              (overview.applications || []).map((row) =>
                Y.jsxs(
                  "div",
                  {
                    style: { padding: "10px 0", borderTop: "1px solid rgba(255,255,255,.08)" },
                    children: [
                      Y.jsxs("strong", { children: [row.fullName, " · ", row.mentorId] }),
                      Y.jsxs("div", { className: "muted", children: [row.email, " · ", row.accountType] }),
                      Y.jsxs("div", {
                        className: "commission-actions",
                        style: { marginTop: 8 },
                        children: [
                          Y.jsx("button", {
                            type: "button",
                            className: "btn btn-blue",
                            disabled: busy !== "",
                            onClick: () =>
                              void act("approve", () =>
                                api(`/api/commissions/admin/applications/${encodeURIComponent(row.mentorId)}/approve`, {
                                  method: "POST",
                                  body: "{}",
                                }),
                              ),
                            children: "Approve",
                          }),
                          Y.jsx("button", {
                            type: "button",
                            className: "btn btn-ghost",
                            style: { borderColor: "var(--red)", color: "var(--red)" },
                            disabled: busy !== "",
                            onClick: () => {
                              const reason = window.prompt("Reason for rejecting this application?");
                              if (!reason) return;
                              return act("reject", () =>
                                api(`/api/commissions/admin/applications/${encodeURIComponent(row.mentorId)}/reject`, {
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
                  row.mentorId,
                ),
              ),
            ],
          })
        : null,
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Commission settings" }),
          Y.jsxs("div", {
            className: "commission-filters",
            children: [
              Y.jsx(Field, {
                label: "Commission per referral",
                children: Y.jsx("input", {
                  type: "number",
                  value: settingsForm.commissionPerReferral,
                  onChange: (ev) =>
                    setSettingsForm({ ...settingsForm, commissionPerReferral: Number(ev.target.value) }),
                }),
              }),
              Y.jsx(Field, {
                label: "Minimum qualifying referrals",
                children: Y.jsx("input", {
                  type: "number",
                  value: settingsForm.minimumQualifyingReferrals,
                  onChange: (ev) =>
                    setSettingsForm({
                      ...settingsForm,
                      minimumQualifyingReferrals: Number(ev.target.value),
                    }),
                }),
              }),
              Y.jsx(Field, {
                label: "Application approval",
                children: Y.jsxs("select", {
                  value: String(settingsForm.requireApproval !== false),
                  onChange: (ev) =>
                    setSettingsForm({ ...settingsForm, requireApproval: ev.target.value === "true" }),
                  children: [
                    Y.jsx("option", { value: "true", children: "Required" }),
                    Y.jsx("option", { value: "false", children: "Auto-activate" }),
                  ],
                }),
              }),
              Y.jsx(Field, {
                label: "Withdrawals",
                children: Y.jsxs("select", {
                  value: String(settingsForm.withdrawalEnabled !== false),
                  onChange: (ev) =>
                    setSettingsForm({ ...settingsForm, withdrawalEnabled: ev.target.value === "true" }),
                  children: [
                    Y.jsx("option", { value: "true", children: "Enabled" }),
                    Y.jsx("option", { value: "false", children: "Paused" }),
                  ],
                }),
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
          Y.jsx(Field, {
            label: "Search name, email, or Mentor/Admin ID",
            children: Y.jsx("input", {
              value: search,
              onChange: (ev) => setSearch(ev.target.value),
              placeholder: "John, mike@…, LM-123456",
            }),
          }),
          Y.jsx("div", {
            className: "commission-chip-row",
            style: { marginTop: 10 },
            children: FILTERS.map(([value, label]) =>
              Y.jsx(
                "button",
                {
                  type: "button",
                  className: `commission-chip${filter === value ? " is-on" : ""}`,
                  onClick: () => {
                    setFilter(value);
                    void load(value, search).catch((err) => onNotice(err.message));
                  },
                  children: label,
                },
                value,
              ),
            ),
          }),
          Y.jsx("button", {
            type: "button",
            className: "btn btn-ghost",
            style: { marginTop: 10, width: "fit-content" },
            onClick: () => void load(filter, search).catch((err) => onNotice(err.message)),
            children: "Apply search",
          }),
        ],
      }),
      Y.jsxs("div", {
        className: "glow-card",
        children: [
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Ranked earners" }),
          Y.jsx("p", { className: "muted", style: { marginTop: 0 }, children: "Highest total earnings first. Super Admin can edit each person’s commission rate and the amounts they already have." }),
          !earners.length
            ? Y.jsx("p", { className: "commission-empty", children: "No enrolled commission earners match this filter." })
            : Y.jsx("div", {
                className: "commission-rank-list",
                children: earners.map((row) =>
                  Y.jsx(
                    RankCard,
                    {
                      row,
                      currency,
                      selected: profile?.mentorId === row.mentorId,
                      onOpen: openProfile,
                    },
                    row.mentorId,
                  ),
                ),
              }),
        ],
      }),
      profile
        ? Y.jsxs("div", {
            className: "glow-card",
            children: [
              Y.jsxs("div", {
                className: "commission-actions",
                style: { justifyContent: "space-between" },
                children: [
                  Y.jsx("h3", { style: { margin: 0 }, children: "Edit this person's commission" }),
                  Y.jsx("button", {
                    type: "button",
                    className: "btn btn-ghost",
                    onClick: () => setProfile(null),
                    children: "Close",
                  }),
                ],
              }),
              Y.jsxs("p", { children: [Y.jsx("strong", { children: "Full name: " }), profile.fullName] }),
              Y.jsxs("p", { children: [Y.jsx("strong", { children: "Account type: " }), profile.accountType] }),
              Y.jsxs("p", { children: [Y.jsx("strong", { children: "ID: " }), profile.mentorId] }),
              Y.jsxs("p", { children: [Y.jsx("strong", { children: "Email: " }), profile.email || "—"] }),
              Y.jsxs("p", { children: [Y.jsx("strong", { children: "Date joined: " }), when(profile.dateJoined || profile.joinedAt)] }),
              Y.jsxs("p", {
                children: [Y.jsx("strong", { children: "Current status: " }), Y.jsx(Badge, { status: profile.currentStatus || profile.status })],
              }),
              Y.jsxs("div", {
                className: "stat-grid admin-stat-grid",
                children: [
                  Y.jsx(Stat, { value: money(profile.totals?.totalEarned, currency), label: "Total earnings" }),
                  Y.jsx(Stat, { value: money(profile.totals?.paidOut, currency), label: "Paid earnings" }),
                  Y.jsx(Stat, { value: money(profile.totals?.pending, currency), label: "Pending earnings" }),
                  Y.jsx(Stat, { value: String(profile.referrals || 0), label: "Total referrals" }),
                  Y.jsx(Stat, {
                    value: String(profile.successfulSubscriptions || 0),
                    label: "Successful subscriptions",
                  }),
                  Y.jsx(Stat, { value: money(profile.rate, currency), label: "Commission rate" }),
                ],
              }),
              Y.jsxs("div", {
                className: "commission-actions",
                children: [
                  Y.jsx("button", {
                    type: "button",
                    className: "btn btn-blue",
                    disabled: busy !== "",
                    onClick: () =>
                      void act("activate", () =>
                        api(`/api/commissions/admin/profiles/${encodeURIComponent(profile.mentorId)}/activate`, {
                          method: "POST",
                          body: "{}",
                        }),
                      ),
                    children: "Activate",
                  }),
                  Y.jsx("button", {
                    type: "button",
                    className: "btn btn-ghost",
                    disabled: busy !== "",
                    onClick: () =>
                      void act("deactivate", () =>
                        api(`/api/commissions/admin/profiles/${encodeURIComponent(profile.mentorId)}/deactivate`, {
                          method: "POST",
                          body: "{}",
                        }),
                      ),
                    children: "Deactivate",
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "commission-edit-panel",
                children: [
                  Y.jsx("h3", { children: "Commission they have" }),
                  Y.jsx("p", {
                    className: "muted",
                    style: { marginTop: 0 },
                    children: "Only Super Admin can change this. Saving a rate applies to future referrals. Editing a history amount or adding an adjustment changes what they currently have.",
                  }),
                  Y.jsxs("div", {
                    className: "commission-filters",
                    children: [
                      Y.jsx(Field, {
                        label: "Personal commission rate",
                        children: Y.jsx("input", {
                          type: "number",
                          min: "0",
                          step: "0.01",
                          value: rateForm,
                          onChange: (ev) => setRateForm(ev.target.value),
                        }),
                      }),
                      Y.jsx(Field, {
                        label: "Credit or debit amount",
                        children: Y.jsx("input", {
                          type: "number",
                          step: "0.01",
                          value: adjust.amount,
                          onChange: (ev) => setAdjust({ ...adjust, amount: ev.target.value, mentorId: profile.mentorId }),
                        }),
                      }),
                      Y.jsx(Field, {
                        label: "Reason for credit/debit",
                        children: Y.jsx("input", {
                          value: adjust.reason,
                          onChange: (ev) => setAdjust({ ...adjust, reason: ev.target.value, mentorId: profile.mentorId }),
                          placeholder: "Required for adjustments",
                        }),
                      }),
                    ],
                  }),
                  Y.jsxs("div", {
                    className: "commission-actions",
                    style: { marginTop: 10 },
                    children: [
                      Y.jsx("button", {
                        type: "button",
                        className: "btn btn-blue",
                        disabled: busy !== "",
                        onClick: () =>
                          void act("rate", async () => {
                            await api(`/api/commissions/admin/profiles/${encodeURIComponent(profile.mentorId)}/rate`, {
                              method: "PUT",
                              body: JSON.stringify({ rate: Number(rateForm) }),
                            });
                            onNotice("Personal commission rate saved.");
                          }),
                        children: "Save rate",
                      }),
                      Y.jsx("button", {
                        type: "button",
                        className: "btn btn-ghost",
                        disabled: busy !== "",
                        onClick: () =>
                          void act("adjust", async () => {
                            await api("/api/commissions/admin/adjust", {
                              method: "POST",
                              body: JSON.stringify({
                                mentorId: profile.mentorId,
                                amount: adjust.amount,
                                reason: adjust.reason,
                              }),
                            });
                            onNotice("Commission balance updated.");
                            setAdjust({ mentorId: profile.mentorId, amount: "50", reason: "" });
                          }),
                        children: "Apply credit/debit",
                      }),
                    ],
                  }),
                ],
              }),
              Y.jsx("h3", { children: "Commission history" }),
              Y.jsx(HistoryTable, {
                rows: profile.commissionHistory,
                currency,
                empty: "No commissions for this earner yet.",
                canEdit: true,
                busy,
                onEditAmount: editCommissionAmount,
              }),
              profile.commissionHistory?.length
                ? Y.jsx("div", {
                    className: "commission-table-wrap",
                    style: { marginTop: 8 },
                    children: (profile.commissionHistory || [])
                      .filter((row) => row.status !== "paid" && row.status !== "reversed")
                      .map((row) =>
                        Y.jsx(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-ghost",
                            style: { marginTop: 6 },
                            disabled: busy !== "",
                            onClick: () =>
                              void act("markpaid", () =>
                                api(`/api/commissions/admin/commissions/${encodeURIComponent(row.eventId)}/paid`, {
                                  method: "POST",
                                  body: "{}",
                                }),
                              ),
                            children: `Mark ${row.eventId} paid`,
                          },
                          `pay-${row.eventId}`,
                        ),
                      ),
                  })
                : null,
              Y.jsx("h3", { children: "Payout history" }),
              !(profile.payoutHistory || []).length
                ? Y.jsx("p", { className: "muted", children: "No payouts yet." })
                : (profile.payoutHistory || []).map((row) =>
                    Y.jsxs(
                      "div",
                      {
                        style: { padding: "8px 0", borderTop: "1px solid rgba(255,255,255,.06)", fontSize: 12 },
                        children: [
                          Y.jsxs("strong", { children: [row.payoutId, " · ", money(row.amount, currency)] }),
                          Y.jsxs("div", { className: "muted", children: [when(row.requestedAt), " · ", row.status] }),
                        ],
                      },
                      row.payoutId,
                    ),
                  ),
            ],
          })
        : null,
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
                      Y.jsxs("strong", { children: [row.payoutId, " · ", money(row.amount, currency)] }),
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
                              void act("approvePay", () =>
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
                              return act("rejectPay", () =>
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
          Y.jsx("h3", { style: { marginTop: 0 }, children: "Manual adjustment" }),
          Y.jsx("p", {
            className: "muted",
            style: { marginTop: 0 },
            children: "Super Admin only. Prefer Edit commission on a ranked earner so the ID is filled in. A reason is required.",
          }),
          Y.jsxs("div", {
            className: "commission-filters",
            children: [
              Y.jsx(Field, {
                label: "Mentor ID",
                children: Y.jsx("input", {
                  value: adjust.mentorId,
                  onChange: (ev) => setAdjust({ ...adjust, mentorId: ev.target.value }),
                  placeholder: admin?.id || "LM-xxxxxx",
                }),
              }),
              Y.jsx(Field, {
                label: "Amount",
                children: Y.jsx("input", {
                  value: adjust.amount,
                  onChange: (ev) => setAdjust({ ...adjust, amount: ev.target.value }),
                }),
              }),
              Y.jsx(Field, {
                label: "Reason",
                children: Y.jsx("input", {
                  value: adjust.reason,
                  onChange: (ev) => setAdjust({ ...adjust, reason: ev.target.value }),
                }),
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
  const [data, setData] = R.useState(null);
  const [error, setError] = R.useState("");
  const [notice, setNotice] = R.useState("");
  const [busy, setBusy] = R.useState("");
  const [tab, setTab] = R.useState("mentor");

  const reload = async () => {
    const me = await api("/api/commissions/me");
    setData(me);
    return me;
  };

  R.useEffect(() => {
    reload()
      .then((me) => {
        if (me?.canManageAll) setTab("admin");
      })
      .catch((err) => {
        if (err.status === 401) setError("Sign in again to load commissions.");
        else setError(err instanceof Error ? err.message : "Could not load commissions.");
      });
  }, []);

  const canManageAll = Boolean(data?.canManageAll);

  return Y.jsxs("div", {
    className: "commission-page",
    children: [
      Y.jsxs("div", {
        className: "commission-actions",
        children: [
          Y.jsx("button", {
            type: "button",
            className: tab === "mentor" || !canManageAll ? "btn btn-blue" : "btn btn-ghost",
            onClick: () => setTab("mentor"),
            children: "My earnings",
          }),
          canManageAll
            ? Y.jsx("button", {
                type: "button",
                className: tab === "admin" ? "btn btn-blue" : "btn btn-ghost",
                onClick: () => setTab("admin"),
                children: "Manage all",
              })
            : null,
        ],
      }),
      error ? Y.jsx("p", { className: "error", children: error }) : null,
      notice ? Y.jsx("p", { style: { margin: 0, color: "var(--green)", fontWeight: 700 }, children: notice }) : null,
      tab === "admin"
        ? canManageAll
          ? Y.jsx(SuperView, { admin, onNotice: setNotice })
          : data
            ? Y.jsx(RestrictedManageAll, {})
            : error
              ? null
              : Y.jsx("p", { className: "muted", children: "Checking commission access…" })
        : data
          ? Y.jsx(MentorView, { data, admin, onReload: reload, busy, setBusy, setNotice })
          : error
            ? null
            : Y.jsx("p", { className: "muted", children: "Loading commissions…" }),
    ],
  });
}

export { CommissionsPage, CommissionsPage as default };
