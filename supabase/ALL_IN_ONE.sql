create table if not exists departments (
  id bigint generated always as identity primary key,
  name text unique not null
);

create table if not exists employees (
  id bigint generated always as identity primary key,
  full_name text not null,
  department_id bigint references departments(id) on delete set null
);

create table if not exists leave_requests (
  id bigint generated always as identity primary key,
  employee_id bigint references employees(id) on delete cascade,
  department_id bigint references departments(id) on delete set null,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists idx_employees_department on employees(department_id);
create index if not exists idx_leave_department on leave_requests(department_id);
create index if not exists idx_leave_status on leave_requests(status);
insert into departments (name)
values ('HR'), ('IT'), ('Sales'), ('Operations')
on conflict (name) do nothing;

insert into employees (full_name, department_id)
select 'Alice Johnson', d.id from departments d where d.name='HR'
union all
select 'Brian Smith', d.id from departments d where d.name='IT'
union all
select 'Cynthia Lee', d.id from departments d where d.name='Sales'
union all
select 'David Brown', d.id from departments d where d.name='Operations';
-- Admin management for Brink Leave System (FIXED FOR SQL EDITOR + BUSINESS RULES)
-- Run this file in Supabase SQL Editor AFTER creating departments/employees/leave_requests tables.

-- 1) Admin table
create table if not exists public.admin_users (
  email text primary key,
  user_id uuid unique,
  is_primary boolean not null default false,
  can_manage_admins boolean not null default false,
  department_ids bigint[] not null default '{}'::bigint[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at current
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at
before update on public.admin_users
for each row execute function public.set_updated_at();

-- 2) Security helpers
create or replace function public.current_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- 3) Enforce business rules for primary admins (FIXED: allows SQL Editor/migrations)
create or replace function public.enforce_admin_rules()
returns trigger
language plpgsql
as $$
declare
  actor_email text := lower(coalesce(current_setting('request.jwt.claim.email', true), ''));
  protected_emails text[] := array['seth.gutridge1@outlook.com', 'mark.gutridge@brink.eu'];
begin
  -- ✅ Allow SQL Editor / migrations to run without JWT context
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op in ('INSERT','UPDATE') then
      new.email := lower(new.email);

      -- Protected primary admins are always primary and can manage admins
      if new.email = any(protected_emails) then
        new.is_primary := true;
        new.can_manage_admins := true;
      end if;

      return new;
    end if;

    if tg_op = 'DELETE' then
      old.email := lower(old.email);

      -- Never allow deleting protected primary admins (even in console)
      if old.email = any(protected_emails) then
        raise exception 'Protected primary admins cannot be removed';
      end if;

      return old;
    end if;
  end if;

  -- ✅ Normal runtime enforcement (app users)
  if actor_email = '' then
    raise exception 'Not authenticated';
  end if;

  if tg_op = 'INSERT' then
    new.email := lower(new.email);

    -- Protected primary admins are always primary and can manage admins
    if new.email = any(protected_emails) then
      new.is_primary := true;
      new.can_manage_admins := true;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.email := lower(new.email);
    old.email := lower(old.email);

    -- Never allow changing the primary admin row's email
    if new.email <> old.email then
      raise exception 'Email cannot be changed';
    end if;

    -- Protected primary admins: only they can edit their own row; nobody else can modify
    if old.email = any(protected_emails) and actor_email <> old.email then
      raise exception 'Protected primary admins cannot be modified by other users';
    end if;

    -- Protected primary admins must remain primary
    if old.email = any(protected_emails) then
      new.is_primary := true;
      new.can_manage_admins := true;
      return new;
    end if;

    -- Primary admin promotion/demotion can only be done by protected primary emails
    if new.is_primary is distinct from old.is_primary then
      if not (actor_email = any(protected_emails)) then
        raise exception 'Only protected primary admins can change primary admin status';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    old.email := lower(old.email);

    -- Never allow deleting protected primary admins
    if old.email = any(protected_emails) then
      raise exception 'Protected primary admins cannot be removed';
    end if;

    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_admin_users_rules on public.admin_users;
create trigger trg_admin_users_rules
before insert or update or delete on public.admin_users
for each row execute function public.enforce_admin_rules();

-- 4) Enable RLS
alter table public.admin_users enable row level security;

-- A) Only admins with can_manage_admins=true can view the admin list
drop policy if exists "admin_users_select_managers" on public.admin_users;
create policy "admin_users_select_managers"
on public.admin_users
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_users me
    where me.email = lower(public.current_email())
      and me.can_manage_admins = true
  )
);

-- B) Allow admin managers to insert/update/delete admins (business rules enforced by trigger)
drop policy if exists "admin_users_write_managers" on public.admin_users;
create policy "admin_users_write_managers"
on public.admin_users
for all
to authenticated
using (
  exists (
    select 1
    from public.admin_users me
    where me.email = lower(public.current_email())
      and me.can_manage_admins = true
  )
)
with check (
  exists (
    select 1
    from public.admin_users me
    where me.email = lower(public.current_email())
      and me.can_manage_admins = true
  )
);

-- C) Allow a user to link their own auth.user_id once (if they were pre-added by email)
drop policy if exists "admin_users_link_own_user_id" on public.admin_users;
create policy "admin_users_link_own_user_id"
on public.admin_users
for update
to authenticated
using (
  email = lower(public.current_email())
)
with check (
  email = lower(public.current_email())
);

-- 5) Seed protected primary admins if missing
insert into public.admin_users (email, is_primary, can_manage_admins, department_ids)
values
  ('seth.gutridge1@outlook.com', true, true, '{}'::bigint[]),
  ('mark.gutridge@brink.eu', true, true, '{}'::bigint[])
on conflict (email) do update
set is_primary = true,
    can_manage_admins = true;
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
