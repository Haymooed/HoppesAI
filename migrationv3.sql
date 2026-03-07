-- Add image tracking columns to profiles
alter table profiles
  add column if not exists daily_imgs int default 0,
  add column if not exists imgs_reset_at timestamptz default now();

-- ── Group Chats ────────────────────────────────────────────
create table if not exists group_chats (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references profiles(id) on delete set null,
  avatar_color text default '#7c3aed',
  created_at timestamptz default now()
);

create table if not exists group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references group_chats(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text default 'member', -- member | admin
  joined_at timestamptz default now(),
  unique(group_id, user_id)
);

create table if not exists group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references group_chats(id) on delete cascade,
  sender_id uuid references profiles(id) on delete set null,
  content text not null,
  msg_type text default 'text', -- text | image | file
  file_url text,
  file_name text,
  created_at timestamptz default now()
);

-- ── Update Logs ────────────────────────────────────────────
create table if not exists update_logs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  version text,
  posted_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- ── RLS ───────────────────────────────────────────────────
alter table group_chats enable row level security;
alter table group_members enable row level security;
alter table group_messages enable row level security;
alter table update_logs enable row level security;

-- Group chats: anyone can read, authenticated can create
create policy "group_chats_read" on group_chats for select using (true);
create policy "group_chats_insert" on group_chats for insert with check (auth.uid() is not null);
create policy "group_chats_update" on group_chats for update using (
  created_by = auth.uid() or
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- Group members
create policy "group_members_read" on group_members for select using (true);
create policy "group_members_insert" on group_members for insert with check (auth.uid() is not null);
create policy "group_members_delete" on group_members for delete using (
  user_id = auth.uid() or
  exists (select 1 from group_members gm where gm.group_id = group_id and gm.user_id = auth.uid() and gm.role = 'admin') or
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- Group messages
create policy "group_messages_read" on group_messages for select using (
  exists (select 1 from group_members where group_id = group_messages.group_id and user_id = auth.uid())
);
create policy "group_messages_insert" on group_messages for insert with check (
  exists (select 1 from group_members where group_id = group_messages.group_id and user_id = auth.uid())
);

-- Update logs: everyone reads, only admins write
create policy "update_logs_read" on update_logs for select using (true);
create policy "update_logs_insert" on update_logs for insert with check (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);
create policy "update_logs_delete" on update_logs for delete using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);