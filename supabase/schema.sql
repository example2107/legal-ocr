create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.projects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  document_ids jsonb not null default '[]'::jsonb,
  shared_pd jsonb not null default '{"persons":[],"otherPD":[]}'::jsonb,
  batch_session jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.documents (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  title text not null,
  original_file_name text not null default '',
  text text not null default '',
  edited_html text not null default '',
  personal_data jsonb not null default '{"persons":[],"otherPD":[],"ambiguousPersons":[]}'::jsonb,
  anonymized jsonb not null default '{}'::jsonb,
  source text not null default 'ocr',
  is_project_summary boolean not null default false,
  page_from integer,
  page_to integer,
  total_pages integer,
  chunk_index integer,
  chunk_size integer,
  batch_file_name text not null default '',
  source_files jsonb not null default '[]'::jsonb,
  page_metadata jsonb,
  coordinate_layer jsonb,
  patch_layer jsonb,
  saved_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.documents
  add column if not exists page_metadata jsonb;

alter table if exists public.documents
  add column if not exists coordinate_layer jsonb;

alter table if exists public.documents
  add column if not exists patch_layer jsonb;

create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists documents_user_id_idx on public.documents(user_id);
create index if not exists documents_project_id_idx on public.documents(project_id);
create index if not exists documents_saved_at_idx on public.documents(saved_at desc);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.documents enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "projects_own_all" on public.projects;
create policy "projects_own_all"
  on public.projects
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "documents_own_all" on public.documents;
create policy "documents_own_all"
  on public.documents
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('source-files', 'source-files', false, 52428800),
  ('exports', 'exports', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "source_files_select_own" on storage.objects;
create policy "source_files_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "source_files_insert_own" on storage.objects;
create policy "source_files_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "source_files_update_own" on storage.objects;
create policy "source_files_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "source_files_delete_own" on storage.objects;
create policy "source_files_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "exports_select_own" on storage.objects;
create policy "exports_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "exports_insert_own" on storage.objects;
create policy "exports_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "exports_update_own" on storage.objects;
create policy "exports_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "exports_delete_own" on storage.objects;
create policy "exports_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
