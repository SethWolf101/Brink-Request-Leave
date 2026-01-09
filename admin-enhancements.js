// Primary Admin overlay tools (NO extra HTML pages)
// - Shows only to PRIMARY admins
// - Lets primary admins manage: admin users (email + 6-digit PIN + dept access), departments, employees, managers
// - Designed to sit on top of the existing SPA without changing the bundled app

(function () {
  const SUPABASE_URL = "https://aoiwcnztsikgdkrkngzy.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8q9fRFh5uj6hbrN47hndlA_nkkr7kFm";

  const OVERLAY_ID = "brink-primary-admin-overlay";
  const OPEN_BTN_ID = "brink-open-primary-tools";

  function isAdminRoute() {
    const p = (window.location.pathname || "").toLowerCase();
    const h = (window.location.hash || "").toLowerCase();
    return p.includes("admin") || h.includes("admin");
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "style") Object.assign(n.style, v);
        else if (k === "class") n.className = v;
        else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
      }
    }
    (children || []).forEach(c => {
      if (c === null || c === undefined) return;
      if (typeof c === "string") n.appendChild(document.createTextNode(c));
      else n.appendChild(c);
    });
    return n;
  }

  function toast(text, ok = true) {
    const t = document.getElementById("brink-primary-toast") || el("div", {
      id: "brink-primary-toast",
      style: {
        position: "fixed",
        right: "18px",
        bottom: "18px",
        zIndex: 2147483647,
        padding: "10px 12px",
        borderRadius: "10px",
        fontSize: "13px",
        maxWidth: "420px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        background: ok ? "rgba(20,140,70,0.95)" : "rgba(180,40,40,0.95)",
        color: "#fff",
        opacity: "0",
        transform: "translateY(8px)",
        transition: "opacity .15s ease, transform .15s ease",
      },
    });
    if (!t.parentElement) document.body.appendChild(t);
    t.textContent = text;
    t.style.background = ok ? "rgba(20,140,70,0.95)" : "rgba(180,40,40,0.95)";
    requestAnimationFrame(() => {
      t.style.opacity = "1";
      t.style.transform = "translateY(0px)";
    });
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => {
      t.style.opacity = "0";
      t.style.transform = "translateY(8px)";
    }, 2600);
  }

  function loadSupabaseUmd() {
    return new Promise((resolve, reject) => {
      if (window.supabase?.createClient) return resolve();
      const existing = document.querySelector('script[data-brink-supabase="1"]');
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Failed to load Supabase library")));
        return;
      }
      const s = document.createElement("script");
      s.dataset.brinkSupabase = "1";
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Supabase library"));
      document.head.appendChild(s);
    });
  }

  async function getClient() {
    await loadSupabaseUmd();
    if (!window._brinkSupabaseClient) {
      window._brinkSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
    return window._brinkSupabaseClient;
  }

  function findAdminPanelAnchor() {
    // Find a visible node that says "Admin Panel" and attach our button nearby.
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,div,span"))
      .filter(n => n.textContent && n.textContent.trim() === "Admin Panel");
    const pick = candidates.find(n => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) || candidates[0];
    return pick?.parentElement || pick || null;
  }

  function ensureButton(container, onClick) {
    if (!container) return;
    if (document.getElementById(OPEN_BTN_ID)) return;

    const btn = el("button", {
      id: OPEN_BTN_ID,
      type: "button",
      style: {
        marginTop: "10px",
        padding: "10px 12px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.22)",
        background: "rgba(255,255,255,0.08)",
        color: "inherit",
        cursor: "pointer",
        fontSize: "14px",
        width: "fit-content",
      },
      onclick: onClick,
    }, ["Primary admin tools"]);

    const hint = el("div", {
      style: {
        marginTop: "6px",
        fontSize: "12px",
        opacity: "0.75",
        maxWidth: "520px",
      },
    }, ["Admins only: manage admins, departments, employees and manager PINs (without any extra pages)."]);

    container.appendChild(btn);
    container.appendChild(hint);
  }

  function buildOverlay() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) return existing;

    const backdrop = el("div", {
      id: OVERLAY_ID,
      style: {
        position: "fixed",
        inset: "0",
        zIndex: 2147483646,
        background: "rgba(0,0,0,0.55)",
        display: "none",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      },
    });

    const panel = el("div", {
      style: {
        width: "min(1100px, 96vw)",
        maxHeight: "86vh",
        overflow: "auto",
        background: "rgba(18,18,20,0.96)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: "18px",
        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
      },
    });

    const header = el("div", {
      style: {
        position: "sticky",
        top: "0",
        background: "rgba(18,18,20,0.98)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
      },
    });

    const title = el("div", { style: { fontWeight: "700", fontSize: "15px" } }, ["Primary admin tools"]);
    const sub = el("div", { style: { fontSize: "12px", opacity: "0.75", marginTop: "2px" } }, ["Edit admins, departments, employees, and manager emails/PINs."]);
    const titleWrap = el("div", null, [title, sub]);

    const closeBtn = el("button", {
      type: "button",
      style: {
        padding: "10px 12px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.22)",
        background: "rgba(255,255,255,0.08)",
        color: "#fff",
        cursor: "pointer",
        fontSize: "14px",
      },
      onclick: () => (backdrop.style.display = "none"),
    }, ["Close"]);

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    const content = el("div", { style: { padding: "14px 16px" } });

    panel.appendChild(header);
    panel.appendChild(content);
    backdrop.appendChild(panel);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.style.display = "none";
    });

    document.body.appendChild(backdrop);
    backdrop._content = content;
    return backdrop;
  }

  function tabButton(name, active, onClick) {
    return el("button", {
      type: "button",
      style: {
        padding: "9px 10px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.07)",
        color: "#fff",
        cursor: "pointer",
        fontSize: "13px",
      },
      onclick: onClick,
    }, [name]);
  }

  function field(label, input) {
    const l = el("div", { style: { fontSize: "12px", opacity: "0.8", marginBottom: "6px" } }, [label]);
    return el("div", { style: { marginBottom: "12px" } }, [l, input]);
  }

  function textInput(placeholder, value = "") {
    const i = el("input", {
      value,
      placeholder,
      style: {
        width: "100%",
        padding: "10px 10px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.07)",
        color: "#fff",
        outline: "none",
        fontSize: "14px",
      },
    });
    return i;
  }

  function smallBtn(label, onClick, danger = false) {
    return el("button", {
      type: "button",
      style: {
        padding: "8px 10px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.18)",
        background: danger ? "rgba(190,55,55,0.30)" : "rgba(255,255,255,0.08)",
        color: "#fff",
        cursor: "pointer",
        fontSize: "13px",
        whiteSpace: "nowrap",
      },
      onclick: onClick,
    }, [label]);
  }

  function makeTable(headers) {
    const table = el("table", {
      style: {
        width: "100%",
        borderCollapse: "separate",
        borderSpacing: "0 10px",
      },
    });
    const thead = el("thead");
    const tr = el("tr");
    headers.forEach(h => tr.appendChild(el("th", {
      style: { textAlign: "left", fontSize: "12px", opacity: "0.75", fontWeight: "600", padding: "0 10px" },
    }, [h])));
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = el("tbody");
    table.appendChild(tbody);
    table._tbody = tbody;
    return table;
  }

  async function openPrimaryTools() {
    const overlay = buildOverlay();
    overlay.style.display = "flex";
    const root = overlay._content;
    root.innerHTML = "";

    const client = await getClient();
    const { data: userRes } = await client.auth.getUser();
    const me = userRes?.user || null;
    if (!me?.email) {
      toast("You are not signed in.", false);
      return;
    }

    // Validate primary admin
    const { data: meRow, error: meErr } = await client
      .from("admin_users")
      .select("email,is_primary,can_manage_admins")
      .eq("email", me.email.toLowerCase())
      .maybeSingle();
    if (meErr) {
      console.error(meErr);
      toast(meErr.message || "Failed to load admin profile", false);
      return;
    }
    if (!meRow?.is_primary) {
      toast("Primary admins only.", false);
      overlay.style.display = "none";
      return;
    }

    // Shared state
    let departments = [];
    let managers = [];
    let admins = [];
    let employees = [];

    async function loadAll() {
      const [{ data: d, error: de }, { data: m, error: me2 }, { data: a, error: ae }, { data: e, error: ee }] =
        await Promise.all([
          client.from("departments").select("id,name").order("name", { ascending: true }),
          client.from("manager_users").select("email,department_id").order("email", { ascending: true }),
          client.from("admin_users").select("email,is_primary,department_ids").order("email", { ascending: true }),
          client.from("employees").select("id,full_name,department_id").order("full_name", { ascending: true }),
        ]);
      if (de) throw de;
      if (me2) throw me2;
      if (ae) throw ae;
      if (ee) throw ee;
      departments = d || [];
      managers = m || [];
      admins = a || [];
      employees = e || [];
    }

    function deptName(id) {
      return (departments.find(x => Number(x.id) === Number(id)) || {}).name || "";
    }

    function managerForDept(deptId) {
      return managers.find(x => Number(x.department_id) === Number(deptId)) || null;
    }

    const toolbar = el("div", {
      style: {
        display: "flex",
        gap: "10px",
        flexWrap: "wrap",
        marginBottom: "14px",
        alignItems: "center",
        justifyContent: "space-between",
      },
    });
    const tabsWrap = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } });
    const refreshBtn = smallBtn("Refresh", async () => {
      try {
        await loadAll();
        renderActive();
        toast("Refreshed");
      } catch (err) {
        console.error(err);
        toast(err?.message || "Refresh failed", false);
      }
    });
    toolbar.appendChild(tabsWrap);
    toolbar.appendChild(refreshBtn);

    root.appendChild(toolbar);

    const pane = el("div");
    root.appendChild(pane);

    let activeTab = "Admins";

    function setActive(name) {
      activeTab = name;
      renderActive();
    }

    function renderTabs() {
      tabsWrap.innerHTML = "";
      ["Admins", "Employees", "Departments", "Managers"].forEach(name => {
        tabsWrap.appendChild(tabButton(name, name === activeTab, () => setActive(name)));
      });
    }

    async function upsertAdmin(payload) {
      const { error } = await client.rpc("upsert_admin_user", payload);
      if (error) throw error;
    }

    async function deleteAdmin(email) {
      const { error } = await client.from("admin_users").delete().eq("email", email.toLowerCase());
      if (error) throw error;
    }

    function renderAdmins() {
      pane.innerHTML = "";
      const card = el("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "16px",
          padding: "14px",
          background: "rgba(255,255,255,0.04)",
        },
      });
      const h = el("div", { style: { fontWeight: "700", marginBottom: "10px" } }, ["Create / Update Admin (Email + 6-digit PIN)"]);
      const form = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } });

      const emailI = textInput("email@company.com");
      const pinI = textInput("6-digit PIN (numbers)");
      pinI.inputMode = "numeric";
      pinI.maxLength = 6;
      pinI.addEventListener("input", () => {
        pinI.value = pinI.value.replace(/\D+/g, "").slice(0, 6);
      });

      const isPrimary = el("label", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "28px" } }, [
        el("input", { type: "checkbox" }),
        el("span", { style: { fontSize: "14px" } }, ["Primary admin"]),
      ]);

      const deptBox = el("div", { style: { gridColumn: "1 / -1" } });
      const deptLabel = el("div", { style: { fontSize: "12px", opacity: "0.8", marginBottom: "6px" } }, [
        "Department access (leave empty = ALL departments)",
      ]);
      const deptGrid = el("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "8px",
          padding: "10px",
          borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.18)",
          background: "rgba(255,255,255,0.07)",
          maxHeight: "180px",
          overflow: "auto",
        },
      });

      const deptChecks = new Map();
      departments.forEach(d => {
        const cb = el("input", { type: "checkbox" });
        deptChecks.set(Number(d.id), cb);
        const row = el("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" } }, [cb, d.name]);
        deptGrid.appendChild(row);
      });
      deptBox.appendChild(deptLabel);
      deptBox.appendChild(deptGrid);

      const actions = el("div", { style: { gridColumn: "1 / -1", display: "flex", gap: "10px" } });
      const genPin = smallBtn("Generate PIN", () => {
        pinI.value = String(Math.floor(100000 + Math.random() * 900000));
      });
      const save = smallBtn("Save admin", async () => {
        const emailV = String(emailI.value || "").trim().toLowerCase();
        const pinV = String(pinI.value || "").trim();
        if (!emailV) return toast("Enter an email", false);
        if (!/^\d{6}$/.test(pinV)) return toast("PIN must be 6 digits", false);

        const selected = Array.from(deptChecks.entries())
          .filter(([, cb]) => cb.checked)
          .map(([id]) => id);
        try {
          await upsertAdmin({
            p_email: emailV,
            p_pin: pinV,
            p_is_primary: isPrimary.querySelector("input").checked,
            p_department_ids: selected,
          });
          await loadAll();
          renderActive();
          toast("Admin saved");
        } catch (err) {
          console.error(err);
          toast(err?.message || "Save failed", false);
        }
      });
      actions.appendChild(genPin);
      actions.appendChild(save);

      form.appendChild(field("Email", emailI));
      form.appendChild(field("PIN", pinI));
      form.appendChild(isPrimary);
      form.appendChild(deptBox);
      form.appendChild(actions);

      const listTitle = el("div", { style: { fontWeight: "700", marginTop: "18px", marginBottom: "8px" } }, ["Existing admins"]);
      const table = makeTable(["Email", "Primary", "Department access", "Actions"]);

      const protectedEmails = new Set(["seth.gutridge1@outlook.com", "mark.gutridge@brink.eu"]);

      admins.forEach(a => {
        const tr = el("tr", {
          style: {
            background: "rgba(255,255,255,0.04)",
            borderRadius: "14px",
          },
        });
        const td = (html) => el("td", { style: { padding: "10px", verticalAlign: "top" } }, [html]);

        const access = (a.department_ids && a.department_ids.length)
          ? a.department_ids.map(id => deptName(id) || `#${id}`).join(", ")
          : "ALL";

        tr.appendChild(td(a.email));
        tr.appendChild(td(a.is_primary ? "Yes" : "No"));
        tr.appendChild(td(access));

        const actionsTd = el("td", { style: { padding: "10px" } });
        const fillBtn = smallBtn("Load", () => {
          emailI.value = a.email;
          isPrimary.querySelector("input").checked = !!a.is_primary;
          pinI.value = "";
          deptChecks.forEach(cb => (cb.checked = false));
          (a.department_ids || []).forEach(id => {
            const cb = deptChecks.get(Number(id));
            if (cb) cb.checked = true;
          });
          toast("Loaded into form");
        });
        actionsTd.appendChild(fillBtn);
        if (!protectedEmails.has(String(a.email || "").toLowerCase())) {
          actionsTd.appendChild(el("span", { style: { display: "inline-block", width: "8px" } }, [""]));
          actionsTd.appendChild(smallBtn("Delete", async () => {
            if (!confirm(`Delete admin ${a.email}?`)) return;
            try {
              await deleteAdmin(a.email);
              await loadAll();
              renderActive();
              toast("Admin deleted");
            } catch (err) {
              console.error(err);
              toast(err?.message || "Delete failed", false);
            }
          }, true));
        }
        tr.appendChild(actionsTd);
        table._tbody.appendChild(tr);
      });

      card.appendChild(h);
      card.appendChild(form);
      card.appendChild(listTitle);
      card.appendChild(table);
      pane.appendChild(card);
    }

    function renderEmployees() {
      pane.innerHTML = "";

      const card = el("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "16px",
          padding: "14px",
          background: "rgba(255,255,255,0.04)",
        },
      });
      card.appendChild(el("div", { style: { fontWeight: "700", marginBottom: "10px" } }, ["Employees (edit name + department)"]));

      const table = makeTable(["Name", "Department", "Actions"]);

      employees.forEach(emp => {
        const tr = el("tr", { style: { background: "rgba(255,255,255,0.04)", borderRadius: "14px" } });
        const nameI = textInput("Full name", emp.full_name || "");
        const sel = el("select", {
          style: {
            width: "100%",
            padding: "10px 10px",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.07)",
            color: "#fff",
            outline: "none",
            fontSize: "14px",
          },
        });
        sel.appendChild(el("option", { value: "" }, ["(none)"]));
        departments.forEach(d => {
          const o = el("option", { value: String(d.id) }, [d.name]);
          if (Number(emp.department_id) === Number(d.id)) o.selected = true;
          sel.appendChild(o);
        });

        const saveBtn = smallBtn("Save", async () => {
          const fullName = String(nameI.value || "").trim();
          const deptId = sel.value ? Number(sel.value) : null;
          if (!fullName) return toast("Name required", false);
          try {
            const { error } = await client
              .from("employees")
              .update({ full_name: fullName, department_id: deptId })
              .eq("id", emp.id);
            if (error) throw error;
            await loadAll();
            renderActive();
            toast("Employee saved");
          } catch (err) {
            console.error(err);
            toast(err?.message || "Save failed", false);
          }
        });

        const delBtn = smallBtn("Delete", async () => {
          if (!confirm(`Delete employee ${emp.full_name}?`)) return;
          try {
            const { error } = await client.from("employees").delete().eq("id", emp.id);
            if (error) throw error;
            await loadAll();
            renderActive();
            toast("Employee deleted");
          } catch (err) {
            console.error(err);
            toast(err?.message || "Delete failed", false);
          }
        }, true);

        tr.appendChild(el("td", { style: { padding: "10px" } }, [nameI]));
        tr.appendChild(el("td", { style: { padding: "10px" } }, [sel]));
        tr.appendChild(el("td", { style: { padding: "10px", display: "flex", gap: "8px" } }, [saveBtn, delBtn]));
        table._tbody.appendChild(tr);
      });

      // Add new employee
      const addWrap = el("div", { style: { marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.12)" } });
      const newName = textInput("New employee name");
      const newDept = el("select", {
        style: {
          width: "100%",
          padding: "10px 10px",
          borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.18)",
          background: "rgba(255,255,255,0.07)",
          color: "#fff",
          outline: "none",
          fontSize: "14px",
        },
      });
      newDept.appendChild(el("option", { value: "" }, ["(none)"]));
      departments.forEach(d => newDept.appendChild(el("option", { value: String(d.id) }, [d.name])));
      const addBtn = smallBtn("Add employee", async () => {
        const fullName = String(newName.value || "").trim();
        const deptId = newDept.value ? Number(newDept.value) : null;
        if (!fullName) return toast("Name required", false);
        try {
          const { error } = await client.from("employees").insert({ full_name: fullName, department_id: deptId });
          if (error) throw error;
          newName.value = "";
          newDept.value = "";
          await loadAll();
          renderActive();
          toast("Employee added");
        } catch (err) {
          console.error(err);
          toast(err?.message || "Add failed", false);
        }
      });

      addWrap.appendChild(el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } }, [
        field("Name", newName),
        field("Department", newDept),
      ]));
      addWrap.appendChild(addBtn);

      card.appendChild(table);
      card.appendChild(addWrap);
      pane.appendChild(card);
    }

    function renderDepartments() {
      pane.innerHTML = "";

      const card = el("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "16px",
          padding: "14px",
          background: "rgba(255,255,255,0.04)",
        },
      });
      card.appendChild(el("div", { style: { fontWeight: "700", marginBottom: "10px" } }, ["Departments (edit names)"]));

      const table = makeTable(["Department", "Actions"]);
      departments.forEach(d => {
        const tr = el("tr", { style: { background: "rgba(255,255,255,0.04)", borderRadius: "14px" } });
        const nameI = textInput("Department name", d.name || "");
        const saveBtn = smallBtn("Save", async () => {
          const name = String(nameI.value || "").trim();
          if (!name) return toast("Name required", false);
          try {
            const { error } = await client.from("departments").update({ name }).eq("id", d.id);
            if (error) throw error;
            await loadAll();
            renderActive();
            toast("Department saved");
          } catch (err) {
            console.error(err);
            toast(err?.message || "Save failed", false);
          }
        });
        const delBtn = smallBtn("Delete", async () => {
          if (!confirm(`Delete department ${d.name}?`)) return;
          try {
            const { error } = await client.from("departments").delete().eq("id", d.id);
            if (error) throw error;
            await loadAll();
            renderActive();
            toast("Department deleted");
          } catch (err) {
            console.error(err);
            toast(err?.message || "Delete failed", false);
          }
        }, true);

        tr.appendChild(el("td", { style: { padding: "10px" } }, [nameI]));
        tr.appendChild(el("td", { style: { padding: "10px", display: "flex", gap: "8px" } }, [saveBtn, delBtn]));
        table._tbody.appendChild(tr);
      });

      const addWrap = el("div", { style: { marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.12)" } });
      const newName = textInput("New department name");
      const addBtn = smallBtn("Add department", async () => {
        const name = String(newName.value || "").trim();
        if (!name) return toast("Name required", false);
        try {
          const { error } = await client.from("departments").insert({ name });
          if (error) throw error;
          newName.value = "";
          await loadAll();
          renderActive();
          toast("Department added");
        } catch (err) {
          console.error(err);
          toast(err?.message || "Add failed", false);
        }
      });
      addWrap.appendChild(field("Name", newName));
      addWrap.appendChild(addBtn);

      card.appendChild(table);
      card.appendChild(addWrap);
      pane.appendChild(card);
    }

    function renderManagers() {
      pane.innerHTML = "";

      const card = el("div", {
        style: {
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "16px",
          padding: "14px",
          background: "rgba(255,255,255,0.04)",
        },
      });
      card.appendChild(el("div", { style: { fontWeight: "700", marginBottom: "10px" } }, ["Managers (edit email + reset PIN)"]));

      const table = makeTable(["Department", "Manager email", "New 6-digit PIN", "Actions"]);
      departments.forEach(d => {
        const tr = el("tr", { style: { background: "rgba(255,255,255,0.04)", borderRadius: "14px" } });
        const current = managerForDept(d.id);
        const emailI = textInput("manager@company.com", current?.email || "");
        const pinI = textInput("6-digit PIN (numbers)", "");
        pinI.inputMode = "numeric";
        pinI.maxLength = 6;
        pinI.addEventListener("input", () => {
          pinI.value = pinI.value.replace(/\D+/g, "").slice(0, 6);
        });

        const genPin = smallBtn("Gen", () => {
          pinI.value = String(Math.floor(100000 + Math.random() * 900000));
        });

        const saveBtn = smallBtn("Save", async () => {
          const emailV = String(emailI.value || "").trim().toLowerCase();
          const pinV = String(pinI.value || "").trim();
          if (!emailV) return toast("Manager email required", false);
          if (!/^\d{6}$/.test(pinV)) return toast("PIN must be 6 digits (enter a new PIN to save)", false);
          try {
            const { error } = await client.rpc("upsert_manager", {
              p_email: emailV,
              p_department_id: Number(d.id),
              p_pin: pinV,
            });
            if (error) throw error;
            pinI.value = "";
            await loadAll();
            renderActive();
            toast("Manager saved");
          } catch (err) {
            console.error(err);
            toast(err?.message || "Save failed", false);
          }
        });

        const removeBtn = smallBtn("Remove", async () => {
          if (!current?.email) return toast("No manager set", false);
          if (!confirm(`Remove manager ${current.email} from ${d.name}?`)) return;
          try {
            const { error } = await client.from("manager_users").delete().eq("email", current.email);
            if (error) throw error;
            await loadAll();
            renderActive();
            toast("Manager removed");
          } catch (err) {
            console.error(err);
            toast(err?.message || "Remove failed", false);
          }
        }, true);

        tr.appendChild(el("td", { style: { padding: "10px" } }, [d.name]));
        tr.appendChild(el("td", { style: { padding: "10px" } }, [emailI]));
        tr.appendChild(el("td", { style: { padding: "10px" } }, [pinI]));
        tr.appendChild(el("td", { style: { padding: "10px", display: "flex", gap: "8px" } }, [genPin, saveBtn, removeBtn]));
        table._tbody.appendChild(tr);
      });

      card.appendChild(table);
      pane.appendChild(card);
    }

    function renderActive() {
      renderTabs();
      if (activeTab === "Admins") return renderAdmins();
      if (activeTab === "Employees") return renderEmployees();
      if (activeTab === "Departments") return renderDepartments();
      if (activeTab === "Managers") return renderManagers();
    }

    try {
      await loadAll();
      renderActive();
    } catch (err) {
      console.error(err);
      toast(err?.message || "Failed to load data", false);
    }
  }

  async function ensurePrimaryButton() {
    if (!isAdminRoute()) return;

    const container = findAdminPanelAnchor();
    if (!container) return;

    // Don't spam checks
    if (container.dataset.brinkPrimaryChecked === "1") return;
    container.dataset.brinkPrimaryChecked = "1";

    try {
      const client = await getClient();
      const { data: u } = await client.auth.getUser();
      const me = u?.user;
      if (!me?.email) return;

      const { data: row } = await client
        .from("admin_users")
        .select("email,is_primary")
        .eq("email", me.email.toLowerCase())
        .maybeSingle();
      if (!row?.is_primary) return;

      ensureButton(container, () => {
        openPrimaryTools().catch(err => {
          console.error(err);
          toast(err?.message || "Failed to open tools", false);
        });
      });
    } catch (err) {
      console.error(err);
      // Silent: avoid breaking UI if Supabase isn't ready
    }
  }

  const obs = new MutationObserver(() => {
    // Re-run when SPA rerenders
    ensurePrimaryButton();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => ensurePrimaryButton());
  window.addEventListener("popstate", () => ensurePrimaryButton());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => ensurePrimaryButton());
  } else {
    ensurePrimaryButton();
  }
})();
