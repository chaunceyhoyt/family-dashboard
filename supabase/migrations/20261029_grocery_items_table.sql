-- Grocery list as one row per item (applied 2026-10-29).
-- Replaces the family_data 'grocery' JSON blob, which is kept untouched as a backup.
create table if not exists public.grocery_items (
  id text primary key,
  text text not null,
  done boolean not null default false,
  pos double precision not null default extract(epoch from now()),
  updated_at timestamptz not null default now()
);

alter table public.grocery_items enable row level security;

create policy "Authenticated users can read grocery_items"
  on public.grocery_items for select to authenticated using (true);
create policy "Authenticated users can write grocery_items"
  on public.grocery_items for all to authenticated using (true) with check (true);

insert into public.grocery_items (id, text, done, pos)
select e->>'id', e->>'text', coalesce((e->>'done')::boolean, false), ord
from family_data, jsonb_array_elements(value) with ordinality as t(e, ord)
where key = 'grocery' and e->>'id' is not null and e->>'text' is not null
on conflict (id) do nothing;

alter publication supabase_realtime add table public.grocery_items;
