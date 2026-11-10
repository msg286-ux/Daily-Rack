-- The Daily Rack: database setup. Paste all of this into Supabase → SQL Editor → New query, then click Run.

-- Press passes: one per player, created automatically when someone signs up.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 30),
  last_name  text not null check (char_length(last_name)  between 1 and 30),
  username   text not null check (username ~ '^[A-Za-z0-9_.]{2,16}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

-- Results: one row per player, per day, per game.
create table if not exists public.results (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  game    text not null check (char_length(game) <= 32),
  score   text check (char_length(score) <= 40),
  rank    numeric,
  grid    text check (char_length(grid) <= 400),
  created_at timestamptz not null default now(),
  primary key (user_id, day, game)
);
create index if not exists results_day_game on public.results (day, game);

-- Who can see and change what: signed-in players can read everyone's press pass and results,
-- but can only add or change their own.
alter table public.profiles enable row level security;
alter table public.results  enable row level security;

drop policy if exists "players read press passes" on public.profiles;
create policy "players read press passes" on public.profiles for select to authenticated using (true);
drop policy if exists "players edit own press pass" on public.profiles;
create policy "players edit own press pass" on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "players read results" on public.results;
create policy "players read results" on public.results for select to authenticated using (true);
drop policy if exists "players add own results" on public.results;
create policy "players add own results" on public.results for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "players change own results" on public.results;
create policy "players change own results" on public.results for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "players remove own results" on public.results;
create policy "players remove own results" on public.results for delete to authenticated using (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.results to authenticated;

-- Create the press pass from the sign-up form's name and username.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name, username)
  values (new.id,
          new.raw_user_meta_data->>'first_name',
          new.raw_user_meta_data->>'last_name',
          new.raw_user_meta_data->>'username');
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the sign-up form check whether a username is free, without exposing anyone's details.
create or replace function public.username_taken(name text) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where lower(username) = lower(name));
$$;
grant execute on function public.username_taken(text) to anon, authenticated;

-- Letters to the editor: game ideas from players. Players can send them; nobody can read them through the site.
-- Read them in Supabase → Table Editor → suggestions.
create table if not exists public.suggestions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  idea text not null check (char_length(idea) between 1 and 140),
  created_at timestamptz not null default now()
);
alter table public.suggestions enable row level security;
drop policy if exists "players send ideas" on public.suggestions;
create policy "players send ideas" on public.suggestions for insert to authenticated with check (auth.uid() = user_id);
grant insert on public.suggestions to authenticated;
