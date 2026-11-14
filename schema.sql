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
