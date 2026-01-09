import { supabase, fmtDate, setNotice, show } from "./supabase.js";

const email = document.getElementById("email");
const pin = document.getElementById("pin");
const sendLinkBtn = document.getElementById("sendLinkBtn");
const unlockBtn = document.getElementById("unlockBtn");
const signOutBtn = document.getElementById("signOutBtn");
const mePill = document.getElementById("mePill");
const deptPill = document.getElementById("deptPill");
const authStatus = document.getElementById("authStatus");
const mgrUi = document.getElementById("mgrUi");
const mgrStatus = document.getElementById("mgrStatus");
const refreshBtn = document.getElementById("refreshBtn");
const statusFilter = document.getElementById("statusFilter");
const tbody = document.getElementById("requestsTbody");
const hint = document.getElementById("hint");

let me = null;
let myDeptId = null;
let myDeptName = "";

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendMagicLink() {
  setNotice(authStatus, "", false);
  const v = String(email.value || "").trim().toLowerCase();
  if (!v) return setNotice(authStatus, "Enter your email.");

  sendLinkBtn.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: v,
      options: { emailRedirectTo: `${window.location.origin}/manager.html` },
    });
    if (error) throw error;
    setNotice(authStatus, "✅ Link sent. Open it on this device.");
  } catch (err) {
    console.error(err);
    setNotice(authStatus, `❌ ${err?.message || "Failed"}`);
  } finally {
    sendLinkBtn.disabled = false;
  }
}

async function loadMe() {
  const { data } = await supabase.auth.getUser();
  me = data?.user || null;
  mePill.textContent = me?.email ? me.email : "Not signed in";
  show(signOutBtn, !!me);
}

async function signOut() {
  await supabase.auth.signOut();
  myDeptId = null;
  myDeptName = "";
  show(mgrUi, false);
  show(deptPill, false);
}

async function unlock() {
  setNotice(authStatus, "", false);
  if (!me?.email) return setNotice(authStatus, "Sign in with email first.");
  const p = String(pin.value || "").trim();
  if (!p) return setNotice(authStatus, "Enter your PIN.");

  unlockBtn.disabled = true;
  try {
    const { data, error } = await supabase.rpc("verify_manager_pin", { p_pin: p });
    if (error) throw error;
    if (!data?.department_id) throw new Error("Wrong PIN (or you are not set up as a manager)." );

    myDeptId = data.department_id;
    myDeptName = data.department_name || "";
    deptPill.textContent = myDeptName ? `Dept: ${myDeptName}` : `Dept #${myDeptId}`;
    show(deptPill, true);
    show(mgrUi, true);
    hint.textContent = myDeptName ? `Showing: ${myDeptName}` : "";
    await loadRequests();
    await initRealtime();
    setNotice(authStatus, "✅ Unlocked.");
  } catch (err) {
    console.error(err);
    setNotice(authStatus, `❌ ${err?.message || "Failed"}`);
  } finally {
    unlockBtn.disabled = false;
  }
}

async function loadRequests() {
  if (!myDeptId) return;
  setNotice(mgrStatus, "", false);
  const st = statusFilter.value;

  let q = supabase
    .from("leave_requests_manager")
    .select("id,employee_name,start_date,end_date,reason,status,created_at")
    .eq("department_id", myDeptId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (st && st !== "all") q = q.eq("status", st);

  const { data, error } = await q;
  if (error) throw error;
  render(data || []);
}

function render(rows) {
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="opacity:0.8">No matching requests.</td></tr>`;
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.employee_name || "")}</td>
      <td>${escapeHtml(r.start_date)} → ${escapeHtml(r.end_date)}</td>
      <td>${escapeHtml(r.reason || "")}</td>
      <td><span class="pill">${escapeHtml(r.status)}</span><div class="muted">${escapeHtml(fmtDate(r.created_at))}</div></td>
      <td>
        <div class="actions">
          <button class="btn btn--ok" data-action="approve" data-id="${r.id}">Approve</button>
          <button class="btn" data-action="reject" data-id="${r.id}">Reject</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

async function setStatus(id, status) {
  const { error } = await supabase.from("leave_requests").update({ status }).eq("id", id);
  if (error) throw error;
}

let realtimeStarted = false;
async function initRealtime() {
  if (realtimeStarted) return;
  realtimeStarted = true;
  const channel = supabase
    .channel("manager-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "leave_requests" },
      () => loadRequests().catch(console.error)
    )
    .subscribe();

  window.addEventListener("beforeunload", () => {
    try { supabase.removeChannel(channel); } catch {}
  });
}

// Events
sendLinkBtn.addEventListener("click", sendMagicLink);
unlockBtn.addEventListener("click", unlock);
signOutBtn.addEventListener("click", signOut);
refreshBtn.addEventListener("click", () => loadRequests().catch(e => setNotice(mgrStatus, e.message)));
statusFilter.addEventListener("change", () => loadRequests().catch(e => setNotice(mgrStatus, e.message)));

tbody.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest("button[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  try {
    if (btn.dataset.action === "approve") await setStatus(id, "approved");
    if (btn.dataset.action === "reject") await setStatus(id, "rejected");
    await loadRequests();
  } catch (err) {
    console.error(err);
    setNotice(mgrStatus, `❌ ${err?.message || "Failed"}`);
  }
});

async function boot() {
  await loadMe();
  // keep UI hidden until unlocked
  show(mgrUi, false);
  show(deptPill, false);
}

supabase.auth.onAuthStateChange(() => boot().catch(err => setNotice(authStatus, err.message)));
boot().catch(err => setNotice(authStatus, err.message));
