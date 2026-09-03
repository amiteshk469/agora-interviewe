-- Role packs: let an interview configuration name a hiring track other than
-- product management.
--
-- The original table pinned profession to a single value, which made the platform
-- structurally PM-only. The panel and rubric were always the real definition of an
-- interview, so this only widens the allowed labels. No row is rewritten and every
-- existing configuration stays valid.

-- Drop the old single-value check by discovery rather than by assumed name, so a
-- differently-named constraint cannot survive and keep rejecting the new tracks.
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
    execute format('alter table public.interview_configs drop constraint %I', constraint_name);
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
      'core_engineering'
    )
  );
