// Inject a "Manage Admins" link into the existing Admin Panel UI without changing the app bundle.
// This is intentionally lightweight and resilient for a static, pre-built SPA.

(function () {
  const LINK_ID = "brink-manage-admins-link";
  const TARGET_HREF = "/admin-management.html";

  function ensureLink() {
    // If already added, do nothing
    if (document.getElementById(LINK_ID)) return;

    // Try to find a reasonable place in the UI: a container that contains "Admin Panel"
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,div,span"))
      .filter(el => el.textContent && el.textContent.trim() === "Admin Panel");

    if (candidates.length === 0) return;

    // Walk up a little to find a container to append into
    let container = candidates[0];
    for (let i = 0; i < 4 && container.parentElement; i++) container = container.parentElement;

    // Create a simple button-like link
    const a = document.createElement("a");
    a.id = LINK_ID;
    a.href = TARGET_HREF;
    a.textContent = "Manage Admins";
    a.style.display = "inline-block";
    a.style.marginTop = "12px";
    a.style.padding = "10px 14px";
    a.style.borderRadius = "10px";
    a.style.border = "1px solid rgba(255,255,255,0.25)";
    a.style.textDecoration = "none";
    a.style.color = "white";
    a.style.fontWeight = "600";
    a.style.background = "rgba(255,255,255,0.08)";

    const hint = document.createElement("div");
    hint.style.marginTop = "6px";
    hint.style.fontSize = "12px";
    hint.style.opacity = "0.8";
    hint.textContent = "Add/remove admins, set department access and primary admins.";

    const wrap = document.createElement("div");
    wrap.style.marginTop = "12px";
    wrap.appendChild(a);
    wrap.appendChild(hint);

    container.appendChild(wrap);
  }

  // Observe SPA route changes / re-renders
  const obs = new MutationObserver(() => ensureLink());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // Initial attempt
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureLink);
  } else {
    ensureLink();
  }
})();
