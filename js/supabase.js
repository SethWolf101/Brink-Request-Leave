import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export function fmtDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

export function show(el, on = true) {
  el?.classList.toggle("hidden", !on);
}

export function setNotice(el, msg, on = true) {
  if (!el) return;
  el.textContent = msg;
  show(el, on);
}
