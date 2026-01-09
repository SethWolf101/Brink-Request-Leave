-- ==============================================
-- BRINK Leave Management - ALL IN ONE Supabase SQL
-- Run this whole file in Supabase SQL Editor.
-- Creates tables used by the Vercel app (including admin access).
-- ==============================================

-- Needed for UUID generation
create extension if not exists pgcrypto;

-- ------------------------------
-- 1) Core tables
-- ------------------------------

create table if not exists public.departments (
  id bigint generated always as identity primary key,
  name text unique not null,
  manager_email text,
  manager_code text
);

create table if not exists public.employees (
  id bigint generated always as identity primary key,
  full_name text not null,
  clock_in_number text,
  department_id bigint references public.departments(id) on delete set null
);

create table if not exists public.leave_requests (
  id bigint generated always as identity primary key,
  employee_id bigint references public.employees(id) on delete cascade,
  department_id bigint references public.departments(id) on delete set null,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists idx_employees_department on public.employees(department_id);
create index if not exists idx_leave_department on public.leave_requests(department_id);
create index if not exists idx_leave_status on public.leave_requests(status);

-- ------------------------------
-- 2) Admin access table
-- ------------------------------
-- NOTE: This app runs fully client-side using the Supabase publishable key,
-- so keep RLS OFF unless you also implement Supabase Auth + policies.

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  is_primary boolean not null default false,
  can_manage_admins boolean not null default false,
  department_ids bigint[] not null default '{}'::bigint[],
  pin_code text not null default '000000',
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

-- ------------------------------
-- 3) Seed your primary admins (pins match the app defaults)
-- ------------------------------
insert into public.admin_users (email, is_primary, can_manage_admins, department_ids, pin_code)
values
  ('seth.gutridge1@outlook.com', true, true, '{}'::bigint[], '123456'),
  ('mark.gutridge@brink.eu', true, true, '{}'::bigint[], '654321')
on conflict (email) do update
set is_primary = excluded.is_primary,
    can_manage_admins = excluded.can_manage_admins,
    pin_code = excluded.pin_code;

-- Done.
