-- Brink Leave System: RLS + safe views + manager PIN login
-- Run AFTER supabase/schema.sql and supabase/admins.sql

-- Needed for password-style hashing of manager PINs
create extension if not exists pgcrypto;

-- 1) Managers table (email + department + hashed PIN)
create table if not exists public.manager_users (
  email text primary key,
  department_id bigint references public.departments(id) on delete cascade,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_manager_users_updated_at on public.manager_users;
create trigger trg_manager_users_updated_at
before update on public.manager_users
for each row execute function public.set_updated_at();

alter table public.manager_users enable row level security;

-- Managers can see their own row
drop policy if exists "manager_users_select_self" on public.manager_users;
create policy "manager_users_select_self"
on public.manager_users
for select
to authenticated
using (lower(email) = lower(public.current_email()));

-- Admins can manage managers
drop policy if exists "manager_users_manage_admins" on public.manager_users;
create policy "manager_users_manage_admins"
on public.manager_users
for all
to authenticated
using (
  exists (select 1 from public.admin_users a where a.email = lower(public.current_email()))
)
with check (
  exists (select 1 from public.admin_users a where a.email = lower(public.current_email()))
);

-- 2) RPC: create/update manager with a new PIN (admins only)
create or replace function public.upsert_manager(p_email text, p_department_id bigint, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := lower(coalesce(current_setting('request.jwt.claim.email', true), ''));
begin
  if actor = '' then
    raise exception 'Not authenticated';
  end if;
  if not exists (select 1 from public.admin_users a where a.email = actor) then
    raise exception 'Not allowed';
  end if;

  insert into public.manager_users(email, department_id, pin_hash)
  values (lower(p_email), p_department_id, crypt(p_pin, gen_salt('bf')))
  on conflict (email) do update
    set department_id = excluded.department_id,
        pin_hash = excluded.pin_hash,
        updated_at = now();
end;
$$;

revoke all on function public.upsert_manager(text, bigint, text) from public;
grant execute on function public.upsert_manager(text, bigint, text) to authenticated;

-- 3) RPC: verify manager PIN (manager must be signed in with Supabase Auth)
create or replace function public.verify_manager_pin(p_pin text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := lower(coalesce(current_setting('request.jwt.claim.email', true), ''));
  r record;
  dept_name text;
begin
  if actor = '' then
    raise exception 'Not authenticated';
  end if;

  select * into r from public.manager_users m where lower(m.email) = actor;
  if not found then
    return json_build_object('ok', false);
  end if;

  if crypt(p_pin, r.pin_hash) <> r.pin_hash then
    return json_build_object('ok', false);
  end if;

  select name into dept_name from public.departments d where d.id = r.department_id;
  return json_build_object('ok', true, 'department_id', r.department_id, 'department_name', dept_name);
end;
$$;

revoke all on function public.verify_manager_pin(text) from public;
grant execute on function public.verify_manager_pin(text) to authenticated;

-- 4) RLS for core tables

-- Admins: allow a signed-in admin to read their own admin row (needed for admin.html)
drop policy if exists "admin_users_select_self" on public.admin_users;
create policy "admin_users_select_self"
on public.admin_users
for select
to authenticated
using (email = lower(public.current_email()));

alter table public.departments enable row level security;
alter table public.employees enable row level security;
alter table public.leave_requests enable row level security;

-- Departments: anyone can read (used by request form)
drop policy if exists "departments_read_all" on public.departments;
create policy "departments_read_all"
on public.departments
for select
to anon, authenticated
using (true);

-- Departments: only admins can write
drop policy if exists "departments_write_admins" on public.departments;
create policy "departments_write_admins"
on public.departments
for all
to authenticated
using (exists (select 1 from public.admin_users a where a.email = lower(public.current_email())))
with check (exists (select 1 from public.admin_users a where a.email = lower(public.current_email())));

-- Employees: anyone can read (used by request form)
drop policy if exists "employees_read_all" on public.employees;
create policy "employees_read_all"
on public.employees
for select
to anon, authenticated
using (true);

-- Employees: only admins can write
drop policy if exists "employees_write_admins" on public.employees;
create policy "employees_write_admins"
on public.employees
for all
to authenticated
using (exists (select 1 from public.admin_users a where a.email = lower(public.current_email())))
with check (exists (select 1 from public.admin_users a where a.email = lower(public.current_email())));

-- Leave requests: anyone can create
drop policy if exists "leave_requests_insert_anon" on public.leave_requests;
create policy "leave_requests_insert_anon"
on public.leave_requests
for insert
to anon, authenticated
with check (true);

-- Leave requests: admins can select/update/delete everything
drop policy if exists "leave_requests_admin_all" on public.leave_requests;
create policy "leave_requests_admin_all"
on public.leave_requests
for all
to authenticated
using (exists (select 1 from public.admin_users a where a.email = lower(public.current_email())))
with check (exists (select 1 from public.admin_users a where a.email = lower(public.current_email())));

-- Leave requests: managers can read/update only their department
drop policy if exists "leave_requests_manager_read_write" on public.leave_requests;
create policy "leave_requests_manager_read_write"
on public.leave_requests
for select
to authenticated
using (
  exists (
    select 1 from public.manager_users m
    where m.email = lower(public.current_email())
      and m.department_id = leave_requests.department_id
  )
);

drop policy if exists "leave_requests_manager_update" on public.leave_requests;
create policy "leave_requests_manager_update"
on public.leave_requests
for update
to authenticated
using (
  exists (
    select 1 from public.manager_users m
    where m.email = lower(public.current_email())
      and m.department_id = leave_requests.department_id
  )
)
with check (
  exists (
    select 1 from public.manager_users m
    where m.email = lower(public.current_email())
      and m.department_id = leave_requests.department_id
  )
);

-- 5) Safe views for the static pages (avoid joining in the frontend)

-- Public: only limited, non-sensitive fields (still includes employee name)
create or replace view public.leave_requests_public as
select
  lr.id,
  e.full_name as employee_name,
  d.name as department_name,
  lr.start_date,
  lr.end_date,
  lr.status,
  lr.created_at
from public.leave_requests lr
left join public.employees e on e.id = lr.employee_id
left join public.departments d on d.id = lr.department_id;

-- Admin: includes reason
create or replace view public.leave_requests_admin as
select
  lr.id,
  lr.employee_id,
  e.full_name as employee_name,
  lr.department_id,
  d.name as department_name,
  lr.start_date,
  lr.end_date,
  lr.reason,
  lr.status,
  lr.created_at
from public.leave_requests lr
left join public.employees e on e.id = lr.employee_id
left join public.departments d on d.id = lr.department_id;

-- Manager: same as admin but limited by RLS on underlying leave_requests
create or replace view public.leave_requests_manager as
select
  lr.id,
  e.full_name as employee_name,
  lr.department_id,
  lr.start_date,
  lr.end_date,
  lr.reason,
  lr.status,
  lr.created_at
from public.leave_requests lr
left join public.employees e on e.id = lr.employee_id;

-- Enable RLS on views by granting access via policies on base tables.
grant select on public.leave_requests_public to anon, authenticated;
grant select on public.leave_requests_admin to authenticated;
grant select on public.leave_requests_manager to authenticated;
