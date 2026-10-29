-- Shared lists (tasks, assets, completed_log) as one row per item (applied 2026-10-29).
-- The matching family_data blobs are kept untouched as a backup.
create table if not exists public.family_items (
  collection text not null,
  id text not null,
  data jsonb not null,
  pos double precision not null default extract(epoch from now()),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

alter table public.family_items enable row level security;

create policy "Authenticated users can read family_items"
  on public.family_items for select to authenticated using (true);
create policy "Authenticated users can write family_items"
  on public.family_items for all to authenticated using (true) with check (true);

-- Deletes need the collection in the realtime payload to route them
alter table public.family_items replica identity full;

insert into public.family_items (collection, id, data, pos)
select key, e->>'id', e, ord
from family_data, jsonb_array_elements(value) with ordinality as t(e, ord)
where key in ('tasks', 'assets', 'completed_log') and e->>'id' is not null
on conflict do nothing;

alter publication supabase_realtime add table public.family_items;
