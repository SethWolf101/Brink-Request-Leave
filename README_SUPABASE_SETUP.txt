SUPABASE + FRONTEND PACK (drop-in files)

1) Copy the folder contents into your project folder:
   - src/supabaseClient.js
   - src/lib/db.js
   - supabase/schema.sql
   - supabase/seed.sql
   - .env.example

2) Install dependencies (in your project root):
   npm install @supabase/supabase-js

3) Create a .env file in your project root (DO NOT COMMIT IT):
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...

4) In Supabase:
   - SQL Editor -> run supabase/schema.sql
   - (optional) run supabase/seed.sql

5) Use the functions in src/lib/db.js from your pages:
   - getDepartments()
   - getEmployees({ departmentId })
   - createLeaveRequest({ employeeId, departmentId, startDate, endDate, reason })
   - getLeaveRequests({ status, departmentId })
   - getPendingSummaryByDepartment()
   - setLeaveRequestStatus({ requestId, status })

If you tell me which file is your Request Leave page and Admin page, I can wire these functions into YOUR UI directly.
