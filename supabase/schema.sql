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
