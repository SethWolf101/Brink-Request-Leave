-- Brink Leave System - ALL IN ONE SQL
-- Run this single file in Supabase SQL Editor.
-- Includes: core schema, admin users (with 6-digit PIN), managers (with 6-digit PIN), RLS + views.

-- =========================
-- 1) Core tables
-- =========================

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

-- =========================
-- 2) Admins (email + primary + dept access + 6-digit PIN)
-- =========================

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  email text primary key,
  user_id uuid unique,
  is_primary boolean not null default false,
  can_manage_admins boolean not null default false,
  pin_hash text,
  department_ids bigint[] not null default '{}'::bigint[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users add column if not exists pin_hash text;

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

create or replace function public.current_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_primary_admin()
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from public.admin_users a
    where a.email = lower(public.current_email())
      and a.is_primary = true
  );
$$;

create or replace function public.admin_allows_department(p_department_id bigint)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.email = lower(public.current_email())
      and (
        coalesce(array_length(a.department_ids, 1), 0) = 0
        or p_department_id = any(a.department_ids)
      )
  );
$$;

create or replace function public.upsert_admin_user(
  p_email text,
  p_pin text,
  p_is_primary boolean,
  p_department_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := lower(coalesce(current_setting('request.jwt.claim.email', true), ''));
  is_actor_primary boolean;
begin
  if actor = '' then
    raise exception 'Not authenticated';
  end if;

  select exists(
    select 1 from public.admin_users a
    where a.email = actor and a.is_primary = true
  ) into is_actor_primary;

  if not is_actor_primary then
    raise exception 'Not allowed';
  end if;

  if p_email is null or trim(p_email) = '' then
    raise exception 'Email is required';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;

  insert into public.admin_users(email, is_primary, can_manage_admins, department_ids, pin_hash)
  values (
    lower(p_email),
    coalesce(p_is_primary, false),
    coalesce(p_is_primary, false),
    coalesce(p_department_ids, '{}'::bigint[]),
    crypt(p_pin, gen_salt('bf'))
  )
  on conflict (email) do update
    set is_primary = excluded.is_primary,
        can_manage_admins = excluded.can_manage_admins,
        department_ids = excluded.department_ids,
        pin_hash = excluded.pin_hash,
        updated_at = now();
end;
$$;

revoke all on function public.upsert_admin_user(text, text, boolean, bigint[]) from public;
grant execute on function public.upsert_admin_user(text, text, boolean, bigint[]) to authenticated;

create or replace function public.verify_admin_pin(p_pin text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := lower(coalesce(current_setting('request.jwt.claim.email', true), ''));
  r record;
begin
  if actor = '' then
    raise exception 'Not authenticated';
  end if;

  select * into r from public.admin_users a where lower(a.email) = actor;
  if not found then
    return json_build_object('ok', false);
  end if;
  if r.pin_hash is null then
    return json_build_object('ok', false);
  end if;
  if crypt(p_pin, r.pin_hash) <> r.pin_hash then
    return json_build_object('ok', false);
  end if;

  return json_build_object(
    'ok', true,
    'is_primary', coalesce(r.is_primary, false),
    'department_ids', coalesce(r.department_ids, '{}'::bigint[])
  );
end;
$$;

revoke all on function public.verify_admin_pin(text) from public;
grant execute on function public.verify_admin_pin(text) to authenticated;

create or replace function public.enforce_admin_rules()
returns trigger
language plpgsql
as $$
declare
  actor_email text := lower(coalesce(current_setting('request.jwt.claim.email', true), ''));
  protected_emails text[] := array['seth.gutridge1@outlook.com', 'mark.gutridge@brink.eu'];
begin
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op in ('INSERT','UPDATE') then
      new.email := lower(new.email);
      if new.email = any(protected_emails) then
        new.is_primary := true;
        new.can_manage_admins := true;
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      old.email := lower(old.email);
      if old.email = any(protected_emails) then
        raise exception 'Protected primary admins cannot be removed';
      end if;
      return old;
    end if;
  end if;

  if actor_email = '' then
    raise exception 'Not authenticated';
  end if;

  if tg_op = 'INSERT' then
    new.email := lower(new.email);
    if new.email = any(protected_emails) then
      new.is_primary := true;
      new.can_manage_admins := true;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.email := lower(new.email);
    old.email := lower(old.email);
    if new.email <> old.email then
      raise exception 'Email cannot be changed';
    end if;
    if old.email = any(protected_emails) and actor_email <> old.email then
      raise exception 'Protected primary admins cannot be modified by other users';
    end if;
    if old.email = any(protected_emails) then
      new.is_primary := true;
      new.can_manage_admins := true;
      return new;
    end if;
    if new.is_primary is distinct from old.is_primary then
      if not (actor_email = any(protected_emails)) then
        raise exception 'Only protected primary admins can change primary admin status';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    old.email := lower(old.email);
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

alter table public.admin_users enable row level security;

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

drop policy if exists "admin_users_write_managers" on public.admin_users;
create policy "admin_users_write_managers"
on public.admin_users
for all
to authenticated
using (public.is_primary_admin())
with check (public.is_primary_admin());

drop policy if exists "admin_users_link_own_user_id" on public.admin_users;
create policy "admin_users_link_own_user_id"
on public.admin_users
for update
to authenticated
using (email = lower(public.current_email()))
with check (email = lower(public.current_email()));

drop policy if exists "admin_users_select_self" on public.admin_users;
create policy "admin_users_select_self"
on public.admin_users
for select
to authenticated
using (email = lower(public.current_email()));

insert into public.admin_users (email, is_primary, can_manage_admins, department_ids)
values
  ('seth.gutridge1@outlook.com', true, true, '{}'::bigint[]),
  ('mark.gutridge@brink.eu', true, true, '{}'::bigint[])
on conflict (email) do update
set is_primary = true,
    can_manage_admins = true;

-- =========================
-- 3) Managers (email + department + 6-digit PIN)
-- =========================

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

drop policy if exists "manager_users_select_self" on public.manager_users;
create policy "manager_users_select_self"
on public.manager_users
for select
to authenticated
using (lower(email) = lower(public.current_email()));

drop policy if exists "manager_users_manage_admins" on public.manager_users;
create policy "manager_users_manage_primary_admins"
on public.manager_users
for all
to authenticated
using (public.is_primary_admin())
with check (public.is_primary_admin());

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
  if not exists (select 1 from public.admin_users a where a.email = actor and a.is_primary = true) then
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

-- =========================
-- 4) RLS for app tables
-- =========================

alter table public.departments enable row level security;
alter table public.employees enable row level security;
alter table public.leave_requests enable row level security;

drop policy if exists "departments_read_all" on public.departments;
create policy "departments_read_all"
on public.departments
for select
to anon, authenticated
using (true);

drop policy if exists "departments_write_admins" on public.departments;
create policy "departments_write_primary_admins"
on public.departments
for all
to authenticated
using (public.is_primary_admin())
with check (public.is_primary_admin());

drop policy if exists "employees_read_all" on public.employees;
create policy "employees_read_all"
on public.employees
for select
to anon, authenticated
using (true);

drop policy if exists "employees_write_admins" on public.employees;
create policy "employees_write_primary_admins"
on public.employees
for all
to authenticated
using (public.is_primary_admin())
with check (public.is_primary_admin());

drop policy if exists "leave_requests_insert_anon" on public.leave_requests;
create policy "leave_requests_insert_anon"
on public.leave_requests
for insert
to anon, authenticated
with check (true);

drop policy if exists "leave_requests_admin_all" on public.leave_requests;
create policy "leave_requests_admin_all"
on public.leave_requests
for all
to authenticated
using (
  exists (select 1 from public.admin_users a where a.email = lower(public.current_email()))
  and public.admin_allows_department(leave_requests.department_id)
)
with check (
  exists (select 1 from public.admin_users a where a.email = lower(public.current_email()))
  and public.admin_allows_department(leave_requests.department_id)
);

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

-- =========================
-- 5) Views
-- =========================

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

grant select on public.leave_requests_public to anon, authenticated;
grant select on public.leave_requests_admin to authenticated;
grant select on public.leave_requests_manager to authenticated;
