BRINK Leave Management — Supabase Sync + Manager Codes

WHY CHANGES WEREN’T SHOWING ON OTHER SCREENS
- The deployed app was saving departments/employees/leave requests in localStorage.
- localStorage is per-device/per-browser, so other users never saw your updates.

WHAT THIS ZIP CHANGES
- The app now uses Supabase as the source of truth for:
  - departments
  - employees
  - leave_requests
- The app subscribes to realtime database changes and automatically refreshes when someone creates/updates/deletes records.
- Manager logins now require a 6-digit manager code (created when the department is added).
- The BRINK image is added as a background on all pages (the UI styling stays the same).

SUPABASE REQUIREMENTS (RUN THIS SQL)
Run your existing schema.sql first, then run this migration to add the extra fields the UI expects:

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS manager_email text,
  ADD COLUMN IF NOT EXISTS manager_code text;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS clock_in_number text;

-- Optional but recommended for performance/uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_manager_email
  ON public.departments (lower(manager_email))
  WHERE manager_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_clock
  ON public.employees (clock_in_number)
  WHERE clock_in_number IS NOT NULL;

NOTES ON SECURITY (IMPORTANT)
- If you have Row Level Security (RLS) ON for these tables, your anon key may not be allowed to read/write.
- For quick testing, you can temporarily disable RLS on these 3 tables:
    ALTER TABLE public.departments DISABLE ROW LEVEL SECURITY;
    ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
    ALTER TABLE public.leave_requests DISABLE ROW LEVEL SECURITY;
  Or create proper policies for the level of security you want.

VERCEL / ENV
- This build uses your project Supabase URL + publishable anon key directly in the compiled bundle.
- If you rotate keys, you must rebuild/redeploy with the new key.

MANAGER LOGIN
- Primary admins: email + their PIN (same as before).
- Department managers: email + the department's 6-digit manager code.
  When a primary admin adds a department, the manager code is generated and shown in a toast.

TROUBLESHOOTING
1) If data still doesn’t sync:
   - Check the browser console for "[Supabase]" errors.
   - Verify the URL/key are correct.
   - Verify RLS is not blocking reads/writes.
2) If realtime doesn't update instantly:
   - The app will still refresh after writes; realtime requires Supabase Realtime to be enabled for the project.

