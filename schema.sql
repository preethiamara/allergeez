create table if not exists profiles (
  id text primary key,
  allergens text[] not null default '{}',
  contact_name text,
  contact_phone text
);

create table if not exists reactions (
  id serial primary key,
  user_id text not null,
  suspected_trigger text,
  created_at timestamptz default now()
);
-- Reaction check-in details (safe to re-run)
alter table reactions add column if not exists symptoms text;
alter table reactions add column if not exists severity int;
alter table reactions add column if not exists duration text;
alter table reactions add column if not exists meal_name text;
alter table reactions add column if not exists occurred_at timestamptz;

create table if not exists meals (
  id serial primary key,
  user_id text not null,
  name text not null,
  details text not null default '',
  flags text[] not null default '{}',
  created_at timestamptz default now()
);
create index if not exists meals_user_created on meals (user_id, created_at desc);
create index if not exists reactions_user_created on reactions (user_id, created_at desc);

-- Cache of packaged-food lookups (Open Food Facts via Bright Data)
create table if not exists food_lookups (
  query text primary key,
  results jsonb not null,
  source text not null,
  created_at timestamptz default now()
);

-- Meal ingredients with user flags: [{"name": "peanuts", "flagged": true}, ...]
alter table meals add column if not exists ingredients jsonb not null default '[]'::jsonb;

-- Short AI "attack tag" title and detected symptoms for each reaction
alter table reactions add column if not exists title text;
alter table reactions add column if not exists symptom_tags text[] not null default '{}';

-- Gee check-ins: each conversation is a Mastra memory thread (Mastra creates its own mastra_* tables in this database).
-- A saved reaction remembers which conversation it came from.
alter table reactions add column if not exists gee_thread_id text;

-- Find food nearby: taste profile, and cached places / menus (OpenStreetMap + Bright Data)
alter table profiles add column if not exists taste_likes text[] not null default '{}';
alter table profiles add column if not exists diet text not null default '';
create table if not exists place_cache (key text primary key, data jsonb not null, created_at timestamptz default now());
