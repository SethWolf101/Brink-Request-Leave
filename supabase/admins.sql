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
