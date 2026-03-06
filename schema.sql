-- ══════════════════════════════════════════════
-- NovaAI — Supabase Database Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query → Run
-- ══════════════════════════════════════════════

-- 1. USER PROFILES
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text not null,
  email        text,
  bio          text default '',
  avatar_char  text default '?',
  created_at   timestamptz default now()
);

-- 2. AI CHATS (one per user session)
create table if not exists ai_chats (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  title      text default 'New Chat',
  model      text default 'meta/llama-3.3-70b-instruct',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. AI MESSAGES
create table if not exists ai_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references ai_chats(id) on delete cascade,
  role       text not null check (role in ('user','assistant','system')),
  content    text not null,
  created_at timestamptz default now()
);

-- 4. DM CHANNELS
create table if not exists dm_channels (
  id           uuid primary key default gen_random_uuid(),
  member_ids   uuid[] not null,
  member_names text[],
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- 5. DM MESSAGES
create table if not exists dm_messages (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references dm_channels(id) on delete cascade,
  sender_id   uuid not null references profiles(id) on delete cascade,
  sender_name text,
  content     text not null,
  created_at  timestamptz default now()
);

-- ══════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════

alter table profiles    enable row level security;
alter table ai_chats    enable row level security;
alter table ai_messages enable row level security;
alter table dm_channels enable row level security;
alter table dm_messages enable row level security;

-- Profiles: anyone logged in can read, only owner can write
create policy "profiles_read"   on profiles for select using (auth.role() = 'authenticated');
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- AI chats: owner only
create policy "ai_chats_all" on ai_chats for all using (auth.uid() = user_id);

-- AI messages: owner only (via chat)
create policy "ai_messages_all" on ai_messages for all
  using (exists (select 1 from ai_chats where ai_chats.id = ai_messages.chat_id and ai_chats.user_id = auth.uid()));

-- DM channels: members only
create policy "dm_channels_read" on dm_channels for select
  using (auth.uid() = any(member_ids));
create policy "dm_channels_insert" on dm_channels for insert
  with check (auth.uid() = any(member_ids));
create policy "dm_channels_update" on dm_channels for update
  using (auth.uid() = any(member_ids));

-- DM messages: channel members only
create policy "dm_messages_read" on dm_messages for select
  using (exists (select 1 from dm_channels where dm_channels.id = dm_messages.channel_id and auth.uid() = any(dm_channels.member_ids)));
create policy "dm_messages_insert" on dm_messages for insert
  with check (auth.uid() = sender_id and exists (select 1 from dm_channels where dm_channels.id = dm_messages.channel_id and auth.uid() = any(dm_channels.member_ids)));

-- ══════════════════════════════════════════════
-- REALTIME (enable for DM messages)
-- ══════════════════════════════════════════════
alter publication supabase_realtime add table dm_messages;