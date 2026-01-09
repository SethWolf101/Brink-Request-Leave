import { supabase, fmtDate, setNotice } from "./supabase.js";
import { LIVE_REFRESH_LIMIT } from "./config.js";

const departmentSelect = document.getElementById("departmentSelect");
const employeeSelect = document.getElementById("employeeSelect");
const startDate = document.getElementById("startDate");
const endDate = document.getElementById("endDate");
const reason = document.getElementById("reason");
const submitBtn = document.getElementById("submitBtn");
const clearBtn = document.getElementById("clearBtn");
const refreshBtn = document.getElementById("refreshBtn");
const status = document.getElementById("status");
const tbody = document.getElementById("requestsTbody");

let departments = [];
let employees = [];

function opt(value, label) {
  const o = document.createElement("option");
  o.value = String(value);
  o.textContent = label;
  return o;
}

async function loadDepartments() {
  const { data, error } = await supabase
    .from("departments")
    .select("id,name")
    .order("name", { ascending: true });
  if (error) throw error;
  departments = data || [];
  departmentSelect.innerHTML = "";
  departmentSelect.appendChild(opt("", "Select..."));
  departments.forEach(d => departmentSelect.appendChild(opt(d.id, d.name)));
}

async function loadEmployees(departmentId) {
  if (!departmentId) {
    employeeSelect.innerHTML = "";
    employeeSelect.appendChild(opt("", "Select a department first"));
    return;
  }

  const { data, error } = await supabase
    .from("employees")
    .select("id,full_name,department_id")
    .eq("department_id", departmentId)
    .order("full_name", { ascending: true });
  if (error) throw error;
  employees = data || [];

  employeeSelect.innerHTML = "";
  employeeSelect.appendChild(opt("", "Select..."));
  employees.forEach(e => employeeSelect.appendChild(opt(e.id, e.full_name)));
}

function departmentNameById(id) {
  return (departments.find(d => Number(d.id) === Number(id)) || {}).name || "";
}

async function loadRecentRequests() {
  // Public view: show only last X created requests (no personal data beyond name)
  // This relies on a policy that allows anon to select a safe view (see SQL).
  const { data, error } = await supabase
    .from("leave_requests_public")
    .select("id,employee_name,department_name,start_date,end_date,status,created_at")
    .order("created_at", { ascending: false })
    .limit(LIVE_REFRESH_LIMIT);
  if (error) throw error;
  renderRequests(data || []);
}

function renderRequests(rows) {
  tbody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "No requests yet.";
    td.style.opacity = "0.8";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.employee_name || "")}</td>
      <td>${escapeHtml(r.department_name || "")}</td>
      <td>${escapeHtml(r.start_date)} → ${escapeHtml(r.end_date)}</td>
      <td><span class="pill">${escapeHtml(r.status)}</span></td>
      <td>${escapeHtml(fmtDate(r.created_at))}</td>
    `;
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearForm() {
  startDate.value = "";
  endDate.value = "";
  reason.value = "";
  employeeSelect.value = "";
}

async function submit() {
  setNotice(status, "", false);

  const deptId = Number(departmentSelect.value);
  const empId = Number(employeeSelect.value);
  const s = startDate.value;
  const e = endDate.value;

  if (!deptId) return setNotice(status, "Pick a department.");
  if (!empId) return setNotice(status, "Pick your name.");
  if (!s || !e) return setNotice(status, "Pick start and end dates.");
  if (e < s) return setNotice(status, "End date can't be before start date.");

  submitBtn.disabled = true;
  try {
    const { error } = await supabase.from("leave_requests").insert({
      employee_id: empId,
      department_id: deptId,
      start_date: s,
      end_date: e,
      reason: reason.value?.trim() || null,
      status: "pending",
    });

    if (error) throw error;

    setNotice(status, "✅ Request submitted. You can close this page.");
    clearForm();
    await loadRecentRequests();
  } catch (err) {
    console.error(err);
    setNotice(status, `❌ ${err?.message || "Failed to submit"}`);
  } finally {
    submitBtn.disabled = false;
  }
}

async function initRealtime() {
  // Live update the public list when someone submits/approves/deletes.
  const channel = supabase
    .channel("public-leave-requests")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "leave_requests" },
      () => loadRecentRequests().catch(console.error)
    )
    .subscribe();

  window.addEventListener("beforeunload", () => {
    try {
      supabase.removeChannel(channel);
    } catch {}
  });
}

departmentSelect.addEventListener("change", async () => {
  const deptId = Number(departmentSelect.value || 0) || null;
  await loadEmployees(deptId);
});

submitBtn.addEventListener("click", submit);
clearBtn.addEventListener("click", clearForm);
refreshBtn.addEventListener("click", () => loadRecentRequests().catch(console.error));

(async function boot() {
  try {
    await loadDepartments();
    await loadEmployees(null);
    await loadRecentRequests();
    await initRealtime();
  } catch (err) {
    console.error(err);
    setNotice(status, `❌ ${err?.message || "Failed to load"}`);
  }
})();
