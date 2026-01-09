import { supabase, fmtDate, setNotice, show } from "./supabase.js";

const authStatus = document.getElementById("authStatus");
const tabStatus = document.getElementById("tabStatus");
const email = document.getElementById("email");
const sendLinkBtn = document.getElementById("sendLinkBtn");
const signOutBtn = document.getElementById("signOutBtn");
const mePill = document.getElementById("mePill");
const rolePill = document.getElementById("rolePill");
const authCard = document.getElementById("authCard");
const adminUi = document.getElementById("adminUi");
const refreshAllBtn = document.getElementById("refreshAllBtn");

// Tabs
const tabButtons = Array.from(document.querySelectorAll("button[data-tab]"));
const tabs = {
  requests: document.getElementById("tab_requests"),
  departments: document.getElementById("tab_departments"),
  employees: document.getElementById("tab_employees"),
  managers: document.getElementById("tab_managers"),
};

// Requests
const filterDept = document.getElementById("filterDept");
const filterStatus = document.getElementById("filterStatus");
const requestsTbody = document.getElementById("requestsAdminTbody");

// Departments
const newDeptName = document.getElementById("newDeptName");
const addDeptBtn = document.getElementById("addDeptBtn");
const departmentsTbody = document.getElementById("departmentsTbody");

// Employees
const newEmpName = document.getElementById("newEmpName");
const newEmpDept = document.getElementById("newEmpDept");
const addEmpBtn = document.getElementById("addEmpBtn");
const employeesTbody = document.getElementById("employeesTbody");

// Managers
const mgrEmail = document.getElementById("mgrEmail");
const mgrDept = document.getElementById("mgrDept");
const mgrPin = document.getElementById("mgrPin");
const saveMgrBtn = document.getElementById("saveMgrBtn");
const genPinBtn = document.getElementById("genPinBtn");
const managersTbody = document.getElementById("managersTbody");

let me = null;
let myAdminRow = null;
let departments = [];

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function opt(value, label) {
  const o = document.createElement("option");
  o.value = String(value);
  o.textContent = label;
  return o;
}

function setTab(name) {
  for (const [k, el] of Object.entries(tabs)) show(el, k === name);
  tabButtons.forEach(b => {
    b.classList.toggle("btn--ok", b.dataset.tab === name);
  });
}

async function sendMagicLink() {
  setNotice(authStatus, "", false);
  const v = String(email.value || "").trim().toLowerCase();
  if (!v) return setNotice(authStatus, "Enter your email.");

  sendLinkBtn.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: v,
      options: {
        emailRedirectTo: `${window.location.origin}/admin.html`,
      },
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

async function signOut() {
  await supabase.auth.signOut();
}

async function loadMe() {
  const { data } = await supabase.auth.getUser();
  me = data?.user || null;
  mePill.textContent = me?.email ? me.email : "Not signed in";
  show(signOutBtn, !!me);
}

async function loadAdminRow() {
  if (!me?.email) {
    myAdminRow = null;
    show(adminUi, false);
    show(rolePill, false);
    return;
  }
  const { data, error } = await supabase
    .from("admin_users")
    .select("email,is_primary,can_manage_admins,department_ids")
    .eq("email", me.email.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  myAdminRow = data || null;
  if (!myAdminRow) {
    setNotice(authStatus, "❌ You are signed in, but you're not listed as an admin. Use the Admin Users page.");
    show(adminUi, false);
    show(rolePill, false);
    return;
  }
  show(adminUi, true);
  rolePill.textContent = myAdminRow.is_primary ? "Primary admin" : "Admin";
  show(rolePill, true);
}

async function loadDepartments() {
  const { data, error } = await supabase
    .from("departments")
    .select("id,name")
    .order("name", { ascending: true });
  if (error) throw error;
  departments = data || [];

  // Filters
  filterDept.innerHTML = "";
  filterDept.appendChild(opt("", "All departments"));
  departments.forEach(d => filterDept.appendChild(opt(d.id, d.name)));

  // Employee create
  newEmpDept.innerHTML = "";
  newEmpDept.appendChild(opt("", "Select..."));
  departments.forEach(d => newEmpDept.appendChild(opt(d.id, d.name)));

  // Manager create
  mgrDept.innerHTML = "";
  mgrDept.appendChild(opt("", "Select..."));
  departments.forEach(d => mgrDept.appendChild(opt(d.id, d.name)));
}

function deptName(id) {
  return (departments.find(d => Number(d.id) === Number(id)) || {}).name || "";
}

async function loadRequests() {
  const deptId = filterDept.value ? Number(filterDept.value) : null;
  const st = filterStatus.value;

  let q = supabase
    .from("leave_requests_admin")
    .select("id,employee_id,employee_name,department_id,department_name,start_date,end_date,reason,status,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (deptId) q = q.eq("department_id", deptId);
  if (st && st !== "all") q = q.eq("status", st);

  const { data, error } = await q;
  if (error) throw error;
  renderRequests(data || []);
}

function renderRequests(rows) {
  requestsTbody.innerHTML = "";
  if (!rows.length) {
    requestsTbody.innerHTML = `<tr><td colspan="6" style="opacity:0.8">No matching requests.</td></tr>`;
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.employee_name || "")}</td>
      <td>${escapeHtml(r.department_name || deptName(r.department_id))}</td>
      <td>
        <input data-edit="start" data-id="${r.id}" type="date" value="${escapeHtml(r.start_date)}" />
        <div style="height:6px"></div>
        <input data-edit="end" data-id="${r.id}" type="date" value="${escapeHtml(r.end_date)}" />
      </td>
      <td><textarea data-edit="reason" data-id="${r.id}" rows="2" placeholder="(optional)">${escapeHtml(r.reason || "")}</textarea></td>
      <td><span class="pill">${escapeHtml(r.status)}</span><div class="muted">${escapeHtml(fmtDate(r.created_at))}</div></td>
      <td>
        <div class="actions">
          <button class="btn btn--ok" data-action="approve" data-id="${r.id}">Approve</button>
          <button class="btn" data-action="reject" data-id="${r.id}">Reject</button>
          <button class="btn" data-action="save" data-id="${r.id}">Save edits</button>
          <button class="btn btn--danger" data-action="delete" data-id="${r.id}">Delete</button>
        </div>
      </td>
    `;
    requestsTbody.appendChild(tr);
  }
}

async function updateRequest(id, patch) {
  const { error } = await supabase.from("leave_requests").update(patch).eq("id", id);
  if (error) throw error;
}

async function deleteRequest(id) {
  const { error } = await supabase.from("leave_requests").delete().eq("id", id);
  if (error) throw error;
}

async function loadDepartmentsTable() {
  departmentsTbody.innerHTML = "";
  for (const d of departments) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <input data-dept-name="${d.id}" value="${escapeHtml(d.name)}" />
      </td>
      <td>
        <div class="actions">
          <button class="btn" data-dept-action="save" data-id="${d.id}">Save</button>
          <button class="btn btn--danger" data-dept-action="delete" data-id="${d.id}">Delete</button>
        </div>
      </td>
    `;
    departmentsTbody.appendChild(tr);
  }
}

async function addDepartment() {
  const name = String(newDeptName.value || "").trim();
  if (!name) return setNotice(tabStatus, "Enter a department name.");
  const { error } = await supabase.from("departments").insert({ name });
  if (error) throw error;
  newDeptName.value = "";
  await refreshAll();
  setNotice(tabStatus, "✅ Department added.");
}

async function saveDepartment(id) {
  const input = document.querySelector(`input[data-dept-name="${id}"]`);
  const name = String(input?.value || "").trim();
  if (!name) return setNotice(tabStatus, "Department name can't be empty.");
  const { error } = await supabase.from("departments").update({ name }).eq("id", id);
  if (error) throw error;
  await refreshAll();
  setNotice(tabStatus, "✅ Department updated.");
}

async function removeDepartment(id) {
  if (!confirm("Delete this department? Employees will have no department.")) return;
  const { error } = await supabase.from("departments").delete().eq("id", id);
  if (error) throw error;
  await refreshAll();
  setNotice(tabStatus, "✅ Department deleted.");
}

async function loadEmployeesTable() {
  const { data, error } = await supabase
    .from("employees")
    .select("id,full_name,department_id")
    .order("full_name", { ascending: true })
    .limit(500);
  if (error) throw error;

  employeesTbody.innerHTML = "";
  for (const e of data || []) {
    const tr = document.createElement("tr");
    const deptOptions = [opt("", "(none)"), ...departments.map(d => opt(d.id, d.name))]
      .map(o => {
        if (String(o.value) === String(e.department_id || "")) o.selected = true;
        return o.outerHTML;
      })
      .join("");

    tr.innerHTML = `
      <td><input data-emp-name="${e.id}" value="${escapeHtml(e.full_name)}" /></td>
      <td>
        <select data-emp-dept="${e.id}">${deptOptions}</select>
      </td>
      <td>
        <div class="actions">
          <button class="btn" data-emp-action="save" data-id="${e.id}">Save</button>
          <button class="btn btn--danger" data-emp-action="delete" data-id="${e.id}">Delete</button>
        </div>
      </td>
    `;
    employeesTbody.appendChild(tr);
  }
}

async function addEmployee() {
  const name = String(newEmpName.value || "").trim();
  const deptId = newEmpDept.value ? Number(newEmpDept.value) : null;
  if (!name) return setNotice(tabStatus, "Enter an employee name.");
  const { error } = await supabase.from("employees").insert({
    full_name: name,
    department_id: deptId,
  });
  if (error) throw error;
  newEmpName.value = "";
  newEmpDept.value = "";
  await refreshAll();
  setNotice(tabStatus, "✅ Employee added.");
}

async function saveEmployee(id) {
  const name = String(document.querySelector(`input[data-emp-name="${id}"]`)?.value || "").trim();
  const deptIdRaw = document.querySelector(`select[data-emp-dept="${id}"]`)?.value;
  const deptId = deptIdRaw ? Number(deptIdRaw) : null;
  if (!name) return setNotice(tabStatus, "Employee name can't be empty.");
  const { error } = await supabase.from("employees").update({
    full_name: name,
    department_id: deptId,
  }).eq("id", id);
  if (error) throw error;
  await refreshAll();
  setNotice(tabStatus, "✅ Employee updated.");
}

async function removeEmployee(id) {
  if (!confirm("Delete this employee? Their requests will also be deleted.")) return;
  const { error } = await supabase.from("employees").delete().eq("id", id);
  if (error) throw error;
  await refreshAll();
  setNotice(tabStatus, "✅ Employee deleted.");
}

function genPin() {
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  mgrPin.value = pin;
}

async function saveManager() {
  const em = String(mgrEmail.value || "").trim().toLowerCase();
  const deptId = mgrDept.value ? Number(mgrDept.value) : null;
  const pin = String(mgrPin.value || "").trim();
  if (!em) return setNotice(tabStatus, "Enter manager email.");
  if (!deptId) return setNotice(tabStatus, "Pick a department.");
  if (!/^[0-9]{4,10}$/.test(pin)) return setNotice(tabStatus, "PIN should be 4-10 digits.");

  const { error } = await supabase.rpc("upsert_manager", {
    p_email: em,
    p_department_id: deptId,
    p_pin: pin,
  });
  if (error) throw error;
  mgrPin.value = "";
  await loadManagers();
  setNotice(tabStatus, "✅ Manager saved. They can now use Manager Dashboard.");
}

async function loadManagers() {
  const { data, error } = await supabase
    .from("manager_users")
    .select("email,department_id")
    .order("email", { ascending: true });
  if (error) throw error;
  managersTbody.innerHTML = "";
  for (const m of data || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(m.email)}</td>
      <td>${escapeHtml(deptName(m.department_id))}</td>
      <td>
        <div class="actions">
          <button class="btn btn--danger" data-mgr-action="delete" data-email="${escapeHtml(m.email)}">Remove</button>
        </div>
      </td>
    `;
    managersTbody.appendChild(tr);
  }
}

async function removeManager(email) {
  if (!confirm("Remove this manager?")) return;
  const { error } = await supabase.from("manager_users").delete().eq("email", email);
  if (error) throw error;
  await loadManagers();
  setNotice(tabStatus, "✅ Manager removed.");
}

async function refreshAll() {
  setNotice(tabStatus, "", false);
  await loadDepartments();
  await loadDepartmentsTable();
  await loadEmployeesTable();
  await loadManagers();
  await loadRequests();
}

async function initRealtime() {
  const channel = supabase
    .channel("admin-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "leave_requests" },
      () => loadRequests().catch(console.error)
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "departments" },
      () => loadDepartments().then(loadDepartmentsTable).catch(console.error)
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "employees" },
      () => loadEmployeesTable().catch(console.error)
    )
    .subscribe();

  window.addEventListener("beforeunload", () => {
    try { supabase.removeChannel(channel); } catch {}
  });
}

// Events
sendLinkBtn.addEventListener("click", sendMagicLink);
signOutBtn.addEventListener("click", signOut);
filterDept.addEventListener("change", () => loadRequests().catch(e => setNotice(tabStatus, e.message)));
filterStatus.addEventListener("change", () => loadRequests().catch(e => setNotice(tabStatus, e.message)));
addDeptBtn.addEventListener("click", () => addDepartment().catch(e => setNotice(tabStatus, e.message)));
addEmpBtn.addEventListener("click", () => addEmployee().catch(e => setNotice(tabStatus, e.message)));
refreshAllBtn.addEventListener("click", () => refreshAll().catch(e => setNotice(tabStatus, e.message)));
genPinBtn.addEventListener("click", genPin);
saveMgrBtn.addEventListener("click", () => saveManager().catch(e => setNotice(tabStatus, e.message)));

tabButtons.forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

requestsTbody.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest("button[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  try {
    if (btn.dataset.action === "approve") await updateRequest(id, { status: "approved" });
    if (btn.dataset.action === "reject") await updateRequest(id, { status: "rejected" });
    if (btn.dataset.action === "delete") await deleteRequest(id);
    if (btn.dataset.action === "save") {
      const s = document.querySelector(`input[data-edit="start"][data-id="${id}"]`)?.value;
      const e = document.querySelector(`input[data-edit="end"][data-id="${id}"]`)?.value;
      const r = document.querySelector(`textarea[data-edit="reason"][data-id="${id}"]`)?.value;
      await updateRequest(id, { start_date: s, end_date: e, reason: (r || "").trim() || null });
    }
    await loadRequests();
  } catch (err) {
    console.error(err);
    setNotice(tabStatus, `❌ ${err?.message || "Failed"}`);
  }
});

departmentsTbody.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest("button[data-dept-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  try {
    if (btn.dataset.deptAction === "save") await saveDepartment(id);
    if (btn.dataset.deptAction === "delete") await removeDepartment(id);
  } catch (err) {
    console.error(err);
    setNotice(tabStatus, `❌ ${err?.message || "Failed"}`);
  }
});

employeesTbody.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest("button[data-emp-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  try {
    if (btn.dataset.empAction === "save") await saveEmployee(id);
    if (btn.dataset.empAction === "delete") await removeEmployee(id);
  } catch (err) {
    console.error(err);
    setNotice(tabStatus, `❌ ${err?.message || "Failed"}`);
  }
});

managersTbody.addEventListener("click", async (ev) => {
  const btn = ev.target?.closest("button[data-mgr-action]");
  if (!btn) return;
  try {
    if (btn.dataset.mgrAction === "delete") await removeManager(btn.dataset.email);
  } catch (err) {
    console.error(err);
    setNotice(tabStatus, `❌ ${err?.message || "Failed"}`);
  }
});

async function boot() {
  setTab("requests");
  await loadMe();
  await loadAdminRow();
  if (myAdminRow) {
    await refreshAll();
    await initRealtime();
  }
}

supabase.auth.onAuthStateChange(() => boot().catch(err => setNotice(authStatus, err.message)));
boot().catch(err => setNotice(authStatus, err.message));
