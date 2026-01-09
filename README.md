# Brink Request Leave (web4)

This is the **static** Brink Request Leave site (no framework build step). It uses **Supabase** for Auth + database.

## 1) Supabase setup (one-time)

1. Create a Supabase project.
2. Open **SQL Editor** in Supabase.
3. Copy/paste and run this file (all-in-one):

- `supabase/ALL_IN_ONE.sql`

That script creates:
- `departments`
- `employees`
- `leave_requests`
- `admin_users` (admins + permissions)
- `manager_users` (manager PIN login)
- views/RLS/policies/RPCs used by the site

> The SQL enforces that Seth/Mark are protected primary admins.

## 2) Add your first admins

After running the SQL, ensure these rows exist in `admin_users`:
- `seth.gutridge1@outlook.com`
- `mark.gutridge@brink.eu`

The ALL_IN_ONE script already inserts/protects them.

## 3) Configure the site to point at Supabase

This is a **static** site, so Supabase is configured in one place:

- `js/config.js`

Set:
- `SUPABASE_URL` (Project URL)
- `SUPABASE_PUBLISHABLE_KEY` (the **sb_publishable_...** key)

You can find both in Supabase: **Project Settings → API**.

## 4) Run locally

Because this is a static site, you can run it with any static server:

```bash
npx serve .
```

Then open the URL printed in the terminal.

## 5) Deploy to Vercel

1. Push this folder to GitHub.
2. In Vercel, import the repo.
3. Make sure **Root Directory** is the folder that contains `index.html` (the `web4/` folder).
4. Redeploy.

## 6) How the admin pages work

- **`/admin.html`** is the main Admin Dashboard.
- The **Admins** tab is **inside the dashboard** (no redirect) and manages `admin_users`.
- Managers are created in the **Managers** tab (email + department + PIN).
- Leave requests can be approved/rejected/edited/deleted in the **Requests** tab.

## Troubleshooting

### Admin tab not showing
- Your signed-in email must exist in `admin_users`.
- To manage admins, your row must have `can_manage_admins = true`.

### Changes not syncing for other people
- This is almost always missing/wrong Vercel env vars.
- After updating env vars, you must **Redeploy**.
