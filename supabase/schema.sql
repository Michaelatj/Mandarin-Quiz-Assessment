-- Mandarin Quiz Assessment - Supabase schema
--
-- Run this once in your Supabase project's SQL editor (Project ->
-- SQL Editor -> New query -> paste -> Run). It creates every table
-- the app needs. There are no user accounts here - this app has one
-- teacher (gated by a shared passcode, see .env) and anonymous
-- students (just a name typed in, same as the original version) -
-- Supabase is used purely as durable storage, not for auth.
--
-- ALREADY RAN AN OLDER VERSION OF THIS FILE? `create table if not
-- exists` won't add new columns to a table that already exists with
-- a different shape (this is the same issue as the "Could not find
-- the 'allow_retakes' column" error, if you've seen that before).
-- If your `questions` table predates the "type" column (added for
-- the sentence-reorder question kind), run this first:
--
--   alter table questions add column if not exists type text not null default 'multiple_choice';
--   alter table questions alter column answer drop not null;
--
-- If anything else about your tables looks out of sync with what's
-- below, the simplest fix is still to drop and recreate:
--
--   drop table if exists attempts cascade;
--   drop table if exists questions cascade;
--   drop table if exists quizzes cascade;
--
-- then run this whole file fresh.

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
  type text not null default 'multiple_choice', -- 'multiple_choice' or 'sentence_reorder'
  question text not null,
  question_meaning text,
  options jsonb not null, -- multiple_choice: the choices. sentence_reorder: the chunks, in CORRECT order (shuffled only when sent to a student)
  option_meanings jsonb, -- multiple_choice only
  answer text, -- multiple_choice only - null for sentence_reorder, whose correct order IS `options` itself
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
