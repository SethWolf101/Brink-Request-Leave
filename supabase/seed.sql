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
