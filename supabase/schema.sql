-- Mandarin Quiz Assessment - Supabase schema
--
-- Run this once in your Supabase project's SQL editor (Project ->
-- SQL Editor -> New query -> paste -> Run). It creates every table
-- the app needs. There are no user accounts here - this app has one
-- teacher (gated by a shared passcode, see .env) and anonymous
-- students (just a name typed in, same as the original version) -
-- Supabase is used purely as durable storage, not for auth.

create table if not exists quizzes (
  id text primary key,
  code text unique not null,
  title text not null,
  description text default '',
  hide_pinyin boolean not null default false,
  time_limit_seconds integer not null default 0,
  allow_retakes boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists questions (
  id text primary key,
  quiz_id text not null references quizzes(id) on delete cascade,
  position integer not null,
  question text not null,
  question_meaning text,
  options jsonb not null,
  option_meanings jsonb,
  answer text not null,
  points numeric not null default 1
);
create index if not exists questions_quiz_idx on questions (quiz_id);

create table if not exists attempts (
  id text primary key,
  quiz_id text not null references quizzes(id) on delete cascade,
  student_name text not null,
  answers jsonb not null default '{}'::jsonb,
  answer_order jsonb not null default '[]'::jsonb,
  accuracy_score numeric,
  xp_score numeric,
  longest_streak integer not null default 0,
  title text, -- the fun per-quiz label (see titles.js), set at submit time
  started_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists attempts_quiz_idx on attempts (quiz_id);

-- Row Level Security is enabled for defense in depth, but the
-- Express server always connects with the Supabase SERVICE ROLE key,
-- which bypasses RLS by design - these deny-by-default policies just
-- make sure nothing is ever reachable directly from a browser using
-- the public anon key, since this app never exposes that key to the
-- client at all.
alter table quizzes enable row level security;
alter table questions enable row level security;
alter table attempts enable row level security;
-- No policies are created, which means: no access at all under the
-- anon key. Only the service-role key (used exclusively by the
-- server) can read or write these tables.
