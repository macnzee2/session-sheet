-- Session Sheet: Supabase schema
-- Run this once in Supabase -> SQL Editor -> New query -> Run

create extension if not exists "pgcrypto";

create table if not exists categories (
  name text primary key
);

create table if not exists teams (
  name text primary key
);

create table if not exists drills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  theme text default '',
  description text default '',
  times_used int default 0,
  created_at timestamptz default now()
);

create table if not exists methods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phases jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  method_id uuid,
  method_name text,
  theme text,
  notes text,
  status text default 'planned',
  phases jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists ratings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  drill_id uuid,
  value int,
  date date,
  created_at timestamptz default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  teams text[] default array['Squad'],
  games_played int default 0,
  position_counts jsonb default '{}'::jsonb,
  rotation_pointer int default 0,
  created_at timestamptz default now()
);

create table if not exists formats (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  positions text[] not null,
  created_at timestamptz default now()
);

create table if not exists matchdays (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  team_filter text default 'All',
  present_player_ids uuid[] default array[]::uuid[],
  games jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

-- Realtime: let the app subscribe to live changes on these tables
alter publication supabase_realtime add table
  categories, teams, drills, methods, sessions, ratings, players, formats, matchdays;

-- Row Level Security: this app has no login system and uses the public "anon" key,
-- so we enable RLS but allow all reads/writes. Fine for a personal/family tool;
-- if you ever add real user accounts, tighten these policies to scope by user.
alter table categories   enable row level security;
alter table teams        enable row level security;
alter table drills       enable row level security;
alter table methods      enable row level security;
alter table sessions     enable row level security;
alter table ratings      enable row level security;
alter table players      enable row level security;
alter table formats      enable row level security;
alter table matchdays    enable row level security;

create policy "public access" on categories for all using (true) with check (true);
create policy "public access" on teams      for all using (true) with check (true);
create policy "public access" on drills     for all using (true) with check (true);
create policy "public access" on methods    for all using (true) with check (true);
create policy "public access" on sessions   for all using (true) with check (true);
create policy "public access" on ratings    for all using (true) with check (true);
create policy "public access" on players    for all using (true) with check (true);
create policy "public access" on formats    for all using (true) with check (true);
create policy "public access" on matchdays  for all using (true) with check (true);
