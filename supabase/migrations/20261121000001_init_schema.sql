-- Core data model for the tradie-matching MVP. See spec.md "Data model".
-- Never edit this file once applied: add a new migration instead
-- (npx supabase migration new <name>).

create type job_status as enum (
  'draft', 'confirmed', 'searching', 'matched', 'en_route',
  'in_progress', 'completed', 'no_match', 'cancelled'
);

create type tier as enum ('low', 'medium', 'high');

create type offer_response as enum ('pending', 'accepted', 'declined', 'withdrawn', 'expired');

create type message_sender as enum ('user', 'tradie');

-- Trade ids must match TRADES in src/lib/job-service/trades.ts.
create function is_valid_trade_list(trades text[]) returns boolean
language sql immutable as $$
  select trades <@ array[
    'plumbing', 'electrical', 'carpentry_handyman', 'roofing_gutters', 'painting',
    'tiling', 'locksmith', 'appliance_repair', 'plastering', 'fencing_landscaping'
  ]::text[]
$$;

-- App users. Separate from auth.users: the MVP has one seeded demo user and no login.
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  home_address text not null,
  home_lat double precision not null,
  home_lng double precision not null,
  created_at timestamptz not null default now()
);

create table tradies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  photo_url text,
  trades text[] not null check (cardinality(trades) > 0 and is_valid_trade_list(trades)),
  max_severity smallint not null check (max_severity between 1 and 5),
  available_now boolean not null default false,
  lat double precision not null,
  lng double precision not null,
  avg_rating numeric(2, 1) check (avg_rating between 1 and 5),
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  status job_status not null default 'draft',
  photos text[] not null default '{}',
  -- Assistant conversation: [{ role, text, photos, at }]
  chat_transcript jsonb not null default '[]',
  -- Summary card: { trade, issueSummary, severity, confidence, safetyFlag, prices, priceReason }
  summary jsonb,
  tier tier,
  required_date date,
  locked_price_min integer check (locked_price_min >= 0),
  locked_price_max integer check (locked_price_max >= locked_price_min),
  tradie_id uuid references tradies (id),
  created_at timestamptz not null default now(),
  -- When the job entered each stage: { "draft": "...", "searching": "...", ... }
  stage_times jsonb not null default '{}'
);

create index jobs_user_id_idx on jobs (user_id, created_at desc);
create index jobs_tradie_id_idx on jobs (tradie_id);

-- A job offered to a tradie during a search wave.
create table offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  tradie_id uuid not null references tradies (id),
  wave smallint not null check (wave >= 1),
  sent_at timestamptz not null default now(),
  response offer_response not null default 'pending',
  responded_at timestamptz,
  unique (job_id, tradie_id)
);

create index offers_tradie_id_idx on offers (tradie_id);

-- User ↔ tradie chat. Separate from the assistant transcript on jobs.
create table messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  sender message_sender not null,
  text text not null check (length(text) > 0),
  sent_at timestamptz not null default now()
);

create index messages_job_id_idx on messages (job_id, sent_at);

-- Reviews of tradies. job_id is null for seeded reviews from past (fictional) customers.
create table reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references jobs (id) on delete cascade,
  tradie_id uuid not null references tradies (id),
  reviewer_name text,
  stars smallint not null check (stars between 1 and 5),
  text text not null default '',
  photos text[] not null default '{}' check (cardinality(photos) <= 3),
  created_at timestamptz not null default now()
);

create index reviews_tradie_id_idx on reviews (tradie_id, created_at desc);

-- Row-level security on, with no public policies yet: only the server
-- (service-role key) can read or write. Browser policies come with realtime screens.
alter table users enable row level security;
alter table tradies enable row level security;
alter table jobs enable row level security;
alter table offers enable row level security;
alter table messages enable row level security;
alter table reviews enable row level security;

-- Real-time from day one (spec.md "Further Notes").
alter publication supabase_realtime add table jobs, offers, messages;
