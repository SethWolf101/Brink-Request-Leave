// Brink Admin Management (static page)
// Uses Supabase Auth (magic link) + RLS-protected admin_users table.
//
// IMPORTANT:
// 1) Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY below.
// 2) In Supabase SQL Editor, run supabase/admins.sql from this repo.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// === CONFIG (set these) ===
const SUPABASE_URL = "https://aoiwcnztsikgdkrkngzy.supabase.co";
// Paste your *publishable* key (sb_publishable_...) here:
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8q9fRFh5uj6hbrN47hndlA_nkkr7kFm";

// Protected primary admins (cannot be removed; only they can change primary admin status)
const PROTECTED_PRIMARY_EMAILS = [
  "seth.gutridge1@outlook.com",
  "mark.gutridge@brink.eu",
];

const el = (id) => document.getElementById(id);

function setNotice(id, msg, show = true) {
  const n = el(id);
  if (!n) return;
  n.textContent = msg;
  n.classList.toggle("hidden", !show);
}

function setHtml(id, html, show = true) {
  const n = el(id);
  if (!n) return;
  n.innerHTML = html;
  n.classList.toggle("hidden", !show);
}

function isConfigured() {
  return !!SUPABASE_URL && !!SUPABASE_PUBLISHABLE_KEY;
}

const supabase = isConfigured() ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;

// UI refs
const authCard = el("authCard");
const envNotice = el("envNotice");
const emailInput = el("email");
const sendLinkBtn = el("sendLinkBtn");
const signOutBtn = el("signOutBtn");
const authStatus = el("authStatus");

const adminUi = el("adminUi");
const noAccess = el("noAccess");
const mePill = el("mePill");
const permPill = el("permPill");
const refreshBtn = el("refreshBtn");

const deptSelect = el("deptSelect");
const adminEmail = el("adminEmail");
const canManage = el("canManage");
const isPrimary = el("isPrimary");
const saveAdminBtn = el("saveAdminBtn");
const clearFormBtn = el("clearFormBtn");
const formStatus = el("formStatus");
const adminsTbody = el("adminsTbody");

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function selectedDeptIds() {
  return Array.from(deptSelect.selectedOptions).map(o => Number(o.value)).filter(n => Number.isFinite(n));
}

function setSelectedDeptIds(ids) {
  const set = new Set((ids || []).map(Number));
  Array.from(deptSelect.options).forEach(o => { o.selected = set.has(Number(o.value)); });
}

async function getSessionUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

async function signInWithMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split("#")[0] }
  });
  if (error) throw error;
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

async function ensureAdminUserLink(user) {
  // If the user was pre-added by email, link their auth user_id to the row.
  // This is allowed by RLS only for the user's own email, and only if user_id is currently null.
  const email = normalizeEmail(user?.email);
  if (!email) return;

  await supabase
    .from("admin_users")
    .update({ user_id: user.id })
    .eq("email", email)
    .is("user_id", null);
}

async function loadDepartments() {
  const { data, error } = await supabase
    .from("departments")
    .select("id,name")
    .order("name", { ascending: true });

  if (error) throw error;

  deptSelect.innerHTML = "";
  for (const d of data || []) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    deptSelect.appendChild(opt);
  }
}

async function myAdminPerms(userEmail) {
  // If the user can select from admin_users at all, they have permission to view the page.
  // Specifically, RLS only allows SELECT when current admin has can_manage_admins=true.
  const { data, error } = await supabase
    .from("admin_users")
    .select("email,is_primary,can_manage_admins,department_ids")
    .eq("email", userEmail)
    .maybeSingle();

  // If select is blocked by RLS, error may be returned or data null.
  if (error) return { hasAccess: false, isPrimary: false, canManage: false, department_ids: [] };
  if (!data) return { hasAccess: false, isPrimary: false, canManage: false, department_ids: [] };

  return {
    hasAccess: true,
    isPrimary: !!data.is_primary,
    canManage: !!data.can_manage_admins,
    department_ids: data.department_ids || []
  };
}

async function loadAdminsList() {
  const { data, error } = await supabase
    .from("admin_users")
    .select("email,is_primary,can_manage_admins,department_ids,created_at,updated_at")
    .order("is_primary", { ascending: false })
    .order("email", { ascending: true });

  if (error) throw error;
  return data || [];
}

function deptNamesMap() {
  const map = new Map();
  Array.from(deptSelect.options).forEach(o => map.set(Number(o.value), o.textContent));
  return map;
}

function renderAdmins(admins, canChangePrimary) {
  const map = deptNamesMap();
  adminsTbody.innerHTML = "";

  for (const a of admins) {
    const tr = document.createElement("tr");

    const deptNames = (a.department_ids || [])
      .map(id => map.get(Number(id)) || String(id))
      .join(", ");

    tr.innerHTML = `
      <td>${a.email}</td>
      <td>${a.is_primary ? "Yes" : "No"}</td>
      <td>${a.can_manage_admins ? "Yes" : "No"}</td>
      <td>${deptNames || "<span class='muted'>None</span>"}</td>
      <td class="actions">
        <button data-action="edit" data-email="${a.email}">Edit</button>
        <button data-action="remove" data-email="${a.email}" class="danger">Remove</button>
      </td>
    `;

    // Protect remove button for protected primary emails (UI guard; DB also enforces)
    if (PROTECTED_PRIMARY_EMAILS.includes(normalizeEmail(a.email))) {
      tr.querySelector('[data-action="remove"]').disabled = true;
      tr.querySelector('[data-action="remove"]').title = "Protected primary admin";
    }

    adminsTbody.appendChild(tr);
  }

  // Primary toggle UI (only enabled if signed-in is protected primary)
  isPrimary.disabled = !canChangePrimary;
}

function fillFormFromAdmin(admin) {
  adminEmail.value = admin.email || "";
  canManage.value = String(!!admin.can_manage_admins);
  isPrimary.value = String(!!admin.is_primary);
  setSelectedDeptIds(admin.department_ids || []);
}

function clearForm() {
  adminEmail.value = "";
  canManage.value = "false";
  isPrimary.value = "false";
  setSelectedDeptIds([]);
  setNotice("formStatus", "", false);
}

async function upsertAdminRow(currentUserEmail, target) {
  // Uses upsert on email primary key
  const payload = {
    email: normalizeEmail(target.email),
    can_manage_admins: target.can_manage_admins,
    is_primary: target.is_primary,
    department_ids: target.department_ids,
  };

  const { error } = await supabase
    .from("admin_users")
    .upsert(payload, { onConflict: "email" });

  if (error) throw error;
}

async function deleteAdminRow(email) {
  const { error } = await supabase.from("admin_users").delete().eq("email", email);
  if (error) throw error;
}

async function bootstrap() {
  if (!isConfigured()) {
    envNotice.classList.remove("hidden");
    setNotice("authStatus", "Admin management is not configured. Set SUPABASE_PUBLISHABLE_KEY in admin-management.js.", true);
    return;
  }

  envNotice.classList.add("hidden");
  setNotice("authStatus", "", false);

  // Wire buttons
  sendLinkBtn.addEventListener("click", async () => {
    try {
      const email = normalizeEmail(emailInput.value);
      if (!email) return setNotice("authStatus", "Enter your email address.", true);
      await signInWithMagicLink(email);
      setNotice("authStatus", "Magic link sent. Check your inbox and open the link on this device.", true);
    } catch (e) {
      setNotice("authStatus", e.message || String(e), true);
    }
  });

  signOutBtn.addEventListener("click", async () => {
    try {
      await signOut();
    } catch (e) {
      setNotice("authStatus", e.message || String(e), true);
    }
  });

  clearFormBtn.addEventListener("click", clearForm);

  saveAdminBtn.addEventListener("click", async () => {
    try {
      setNotice("formStatus", "", false);

      const user = await getSessionUser();
      if (!user) return setNotice("formStatus", "You must be signed in.", true);

      const me = normalizeEmail(user.email);
      const email = normalizeEmail(adminEmail.value);
      if (!email) return setNotice("formStatus", "Admin email is required.", true);

      const target = {
        email,
        can_manage_admins: canManage.value === "true",
        is_primary: isPrimary.value === "true",
        department_ids: selectedDeptIds(),
      };

      await upsertAdminRow(me, target);
      setNotice("formStatus", "Saved.", true);
      await refreshUi();
    } catch (e) {
      setNotice("formStatus", e.message || String(e), true);
    }
  });

  refreshBtn.addEventListener("click", refreshUi);

  adminsTbody.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest("button");
    if (!btn) return;

    const action = btn.getAttribute("data-action");
    const email = btn.getAttribute("data-email");
    if (!action || !email) return;

    try {
      const admins = await loadAdminsList();
      const a = admins.find(x => normalizeEmail(x.email) === normalizeEmail(email));
      if (!a) return;

      if (action === "edit") {
        fillFormFromAdmin(a);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (action === "remove") {
        if (!confirm(`Remove admin access for ${email}?`)) return;
        await deleteAdminRow(email);
        await refreshUi();
      }
    } catch (e) {
      alert(e.message || String(e));
    }
  });

  // React to auth state
  supabase.auth.onAuthStateChange(async () => {
    await refreshUi();
  });

  await refreshUi();
}

async function refreshUi() {
  const user = await getSessionUser();

  if (!user) {
    mePill.textContent = "Not signed in";
    permPill.classList.add("hidden");
    signOutBtn.classList.add("hidden");
    refreshBtn.classList.add("hidden");
    adminUi.classList.add("hidden");
    noAccess.classList.add("hidden");
    return;
  }

  signOutBtn.classList.remove("hidden");
  refreshBtn.classList.remove("hidden");
  mePill.textContent = normalizeEmail(user.email);

  // Link user_id if pre-added
  await ensureAdminUserLink(user);

  // Load departments first (needed to render dept names)
  await loadDepartments();

  // Check access
  const perms = await myAdminPerms(normalizeEmail(user.email));

  if (!perms.hasAccess || !perms.canManage) {
    permPill.textContent = "No admin-management access";
    permPill.classList.remove("hidden");
    adminUi.classList.add("hidden");
    noAccess.classList.remove("hidden");
    return;
  }

  permPill.textContent = perms.isPrimary ? "Primary admin" : "Admin manager";
  permPill.classList.remove("hidden");
  noAccess.classList.add("hidden");
  adminUi.classList.remove("hidden");

  // Only protected primary admins can change primary status (UI gate; DB enforces too)
  const canChangePrimary = PROTECTED_PRIMARY_EMAILS.includes(normalizeEmail(user.email));

  const admins = await loadAdminsList();
  renderAdmins(admins, canChangePrimary);
}

// Start
bootstrap();
