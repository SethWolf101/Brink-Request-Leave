// Inject a "Manage Admins" link into the existing Admin Panel UI without changing the app bundle.
// Guarded so it DOES NOT run on the homepage (which also contains an "Admin Panel" card).

(function () {
  const LINK_ID = "brink-manage-admins-link";
  const TARGET_HREF = "/admin-management.html";

  function isAdminRoute() {
    const p = (window.location.pathname || "").toLowerCase();
    const h = (window.location.hash || "").toLowerCase();
    // Run only when the user is on an admin-related route (not the landing page).
    return p.includes("admin") || h.includes("admin");
  }

  function ensureLink() {
    if (!isAdminRoute()) return;

    // If already added, do nothing
    if (document.getElementById(LINK_ID)) return;

    // Try to find a reasonable place in the UI: a container that contains "Admin Panel"
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,div,span"))
      .filter(el => el.textContent && el.textContent.trim() === "Admin Panel");

    if (candidates.length === 0) return;

    // Choose the first candidate that is visible and on-screen-ish
    const target = candidates.find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || candidates[0];

    // Create link element
    const wrap = document.createElement("div");
    wrap.id = LINK_ID;
    wrap.style.marginTop = "10px";
    wrap.style.fontSize = "14px";
    wrap.style.opacity = "0.9";

    const a = document.createElement("a");
    a.href = TARGET_HREF;
    a.textContent = "Manage Admins";
    a.style.textDecoration = "underline";
    a.style.cursor = "pointer";

    const desc = document.createElement("div");
    desc.textContent = "Add/remove admins, set department access and primary admins.";
    desc.style.fontSize = "12px";
    desc.style.opacity = "0.75";

    wrap.appendChild(a);
    wrap.appendChild(desc);

    // Also link to the full Admin Dashboard (legacy static page)
    const a2 = document.createElement("a");
    a2.href = "/admin.html";
    a2.textContent = "Admin Dashboard";
    a2.style.textDecoration = "underline";
    a2.style.cursor = "pointer";
    a2.style.display = "inline-block";
    a2.style.marginTop = "8px";

    const desc2 = document.createElement("div");
    desc2.textContent = "Manage departments, employees, managers and requests.";
    desc2.style.fontSize = "12px";
    desc2.style.opacity = "0.75";

    wrap.appendChild(a2);
    wrap.appendChild(desc2);

    // Append near the target, but avoid breaking layout
    const container = target.parentElement || target;
    container.appendChild(wrap);
  }

  // Observe SPA route changes / re-renders
  const obs = new MutationObserver(() => ensureLink());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // Also re-check when navigation occurs
  window.addEventListener("hashchange", ensureLink);
  window.addEventListener("popstate", ensureLink);

  // Initial attempt
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureLink);
  } else {
    ensureLink();
  }
})();
