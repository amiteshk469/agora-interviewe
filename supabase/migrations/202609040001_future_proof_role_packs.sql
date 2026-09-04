-- Expand the database allowlist to the complete role-pack catalogue shipped by
-- this release. Keep the database and API invariants aligned because signed-in
-- users may also write their own rows through Supabase RLS.
--
-- This migration must land before the backend release that exposes the eight
-- new packs, otherwise Postgres will reject otherwise-valid configurations.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'interview_configs'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%profession%'
  loop
    execute format(
      'alter table public.interview_configs drop constraint %I',
      constraint_name
    );
  end loop;
end
$$;

alter table public.interview_configs
  add constraint interview_configs_profession_check
  check (
    profession in (
      'product_management',
      'software_engineering',
      'data_science',
      'machine_learning',
      'quantitative_finance',
      'consulting',
      'hardware_vlsi',
      'embedded_systems',
      'cloud_devops',
      'core_engineering',
      'ui_ux_design',
      'data_engineering',
      'cybersecurity',
      'electrical_electronics',
      'aerospace_robotics',
      'operations_management',
      'finance_risk',
      'civil_chemical_materials'
    )
  );
