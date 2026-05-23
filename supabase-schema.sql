create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create or replace function public.normalize_station_text(p_input text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(
    regexp_replace(
      lower(coalesce(p_input, '')),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.redact_sensitive_text(p_input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_output text := trim(coalesce(p_input, ''));
begin
  if v_output = '' then
    return null;
  end if;

  v_output := regexp_replace(v_output, '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[email removed]', 'gi');
  v_output := regexp_replace(v_output, '(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?)\d{3}[\s\-.]?\d{4}', '[phone removed]', 'g');
  v_output := regexp_replace(v_output, '\b\d{1,6}\s+[A-Za-z0-9.\- ]+\s(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|circle|cir|highway|hwy|boulevard|blvd)\b', '[address removed]', 'gi');
  v_output := regexp_replace(v_output, '\b(?:1Z[0-9A-Z]{16}|[0-9A-Z]{12,24})\b', '[tracking removed]', 'gi');
  v_output := regexp_replace(v_output, '\s+', ' ', 'g');

  return trim(v_output);
end;
$$;

create or replace function public.split_feedback_items(p_input text)
returns table(display_text text, normalized_text text)
language sql
immutable
set search_path = public
as $$
  with raw_items as (
    select trim(item_value) as item_text
    from unnest(regexp_split_to_array(coalesce(p_input, ''), E'[,;/\\n]+')) as item_value
  )
  select
    item_text as display_text,
    public.normalize_station_text(item_text) as normalized_text
  from raw_items
  where item_text <> '';
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.station_settings (
  id uuid primary key default gen_random_uuid(),
  singleton_key boolean not null default true unique,
  current_status text not null default 'Fresh snacks added today',
  status_note text not null default 'Live updates appear here after the site is connected.',
  admin_passcode_hash text,
  email_notifications_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.snack_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  normalized_title text not null unique,
  category text not null default 'Snacks',
  aliases text[] not null default '{}'::text[],
  vote_count integer not null default 0,
  approved boolean not null default false,
  hidden boolean not null default false,
  created_by_user boolean not null default false,
  needs_review boolean not null default false,
  created_by_session_id text,
  created_by_submission_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.snack_submissions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  selected_snack_ids uuid[] not null default '{}'::uuid[],
  selected_snack_titles text[] not null default '{}'::text[],
  custom_snack_original text,
  custom_snack_normalized text,
  matched_snack_id uuid references public.snack_items(id) on delete set null,
  custom_snack_decision text,
  preferred_water_brand text,
  preferred_water_brand_redacted text,
  wants_added text,
  wants_added_redacted text,
  dislikes text,
  dislikes_redacted text,
  delivery_frequency text not null default 'First time',
  area_delivery text not null default 'Not sure',
  neighborhood_sighting text not null default 'Not sure',
  wasilla_sighting text not null default 'Not sure',
  message text,
  message_redacted text,
  nickname text,
  nickname_redacted text,
  submitted_anonymously boolean not null default true,
  needs_review boolean not null default false,
  hidden boolean not null default false,
  moderation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint snack_submissions_delivery_frequency_check check (
    delivery_frequency in ('First time', 'Rarely', 'Sometimes', 'Often', 'I am a regular delivery driver here')
  ),
  constraint snack_submissions_area_delivery_check check (
    area_delivery in ('Temporary', 'Usually deliver in Wasilla', 'Not sure', 'Prefer not to answer')
  ),
  constraint snack_submissions_neighborhood_sighting_check check (
    neighborhood_sighting in ('Yes', 'No', 'Not sure')
  ),
  constraint snack_submissions_wasilla_sighting_check check (
    wasilla_sighting in ('Yes', 'No', 'Not sure')
  )
);

create table if not exists public.public_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.snack_submissions(id) on delete cascade,
  nickname text,
  comment_text text not null,
  approved boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.snack_votes (
  id uuid primary key default gen_random_uuid(),
  snack_id uuid not null references public.snack_items(id) on delete cascade,
  session_id text not null,
  created_at timestamptz not null default now(),
  constraint snack_votes_snack_id_session_id_key unique (snack_id, session_id)
);

do $$
begin
  alter table public.snack_items
    add constraint snack_items_created_by_submission_id_fkey
    foreign key (created_by_submission_id)
    references public.snack_submissions(id)
    on delete set null;
exception
  when duplicate_object then
    null;
end;
$$;

create index if not exists snack_items_approved_hidden_idx on public.snack_items (approved, hidden);
create index if not exists snack_items_needs_review_idx on public.snack_items (needs_review, approved, hidden);
create index if not exists snack_submissions_created_at_idx on public.snack_submissions (created_at desc);
create index if not exists snack_submissions_hidden_created_at_idx on public.snack_submissions (hidden, created_at desc);
create index if not exists public_comments_visibility_idx on public.public_comments (approved, hidden, created_at desc);
create index if not exists snack_votes_snack_id_idx on public.snack_votes (snack_id);

drop trigger if exists set_station_settings_updated_at on public.station_settings;
create trigger set_station_settings_updated_at
before update on public.station_settings
for each row
execute function public.set_updated_at();

drop trigger if exists set_snack_items_updated_at on public.snack_items;
create trigger set_snack_items_updated_at
before update on public.snack_items
for each row
execute function public.set_updated_at();

drop trigger if exists set_snack_submissions_updated_at on public.snack_submissions;
create trigger set_snack_submissions_updated_at
before update on public.snack_submissions
for each row
execute function public.set_updated_at();

drop trigger if exists set_public_comments_updated_at on public.public_comments;
create trigger set_public_comments_updated_at
before update on public.public_comments
for each row
execute function public.set_updated_at();

create or replace function public.refresh_snack_vote_count(p_snack_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  update public.snack_items
  set vote_count = (
    select count(*)
    from public.snack_votes
    where snack_id = p_snack_id
  )
  where id = p_snack_id;
end;
$$;

create or replace function public.handle_snack_vote_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.refresh_snack_vote_count(new.snack_id);
    return new;
  end if;

  perform public.refresh_snack_vote_count(old.snack_id);
  return old;
end;
$$;

drop trigger if exists snack_votes_refresh_count_after_insert on public.snack_votes;
create trigger snack_votes_refresh_count_after_insert
after insert on public.snack_votes
for each row
execute function public.handle_snack_vote_change();

drop trigger if exists snack_votes_refresh_count_after_delete on public.snack_votes;
create trigger snack_votes_refresh_count_after_delete
after delete on public.snack_votes
for each row
execute function public.handle_snack_vote_change();

insert into public.station_settings (
  singleton_key,
  current_status,
  status_note
)
values (
  true,
  'Fresh snacks added today',
  'Live updates appear here after the site is connected.'
)
on conflict (singleton_key) do update
set
  current_status = excluded.current_status,
  status_note = excluded.status_note,
  updated_at = now();

insert into public.snack_items (
  title,
  normalized_title,
  category,
  aliases,
  vote_count,
  approved,
  hidden,
  created_by_user,
  needs_review
)
values
  ('Oreo Cookies', 'oreo cookies', 'Cookies', array['oreo', 'oreos'], 0, true, false, false, false),
  ('Doritos', 'doritos', 'Chips', array['dorritos'], 0, true, false, false, false),
  ('Lay''s Chips', 'lays chips', 'Chips', array['lays', 'potato chips', 'lays potato chips'], 0, true, false, false, false),
  ('Cheetos Crunchy', 'cheetos crunchy', 'Chips', array['cheetos', 'crunchy cheetos'], 0, true, false, false, false),
  ('Mini Chips Ahoy', 'mini chips ahoy', 'Cookies', array['chips ahoy', 'mini chips ahoy cookies'], 0, true, false, false, false),
  ('Teddy Grahams', 'teddy grahams', 'Cookies', array['teddy grahams honey', 'graham snacks'], 0, true, false, false, false),
  ('Nutter Butter Bites', 'nutter butter bites', 'Cookies', array['nutter butter', 'peanut butter bites'], 0, true, false, false, false),
  ('Goldfish Crackers', 'goldfish crackers', 'Crackers', array['goldfish'], 0, true, false, false, false),
  ('Ritz Bits', 'ritz bits', 'Crackers', array['ritz bits cheese', 'ritz bits peanut butter'], 0, true, false, false, false),
  ('Cheez-It Crackers', 'cheez it crackers', 'Crackers', array['cheez it', 'cheezits', 'cheez itz'], 0, true, false, false, false),
  ('Mott''s Fruit Snacks', 'motts fruit snacks', 'Other Snack', array['fruit snacks', 'motts', 'motts assorted fruit'], 0, true, false, false, false),
  ('Gushers', 'gushers', 'Other Snack', array['fruit gushers'], 0, true, false, false, false),
  ('Fruit Roll-Ups', 'fruit roll ups', 'Other Snack', array['fruit rollups'], 0, true, false, false, false),
  ('Fruit by the Foot', 'fruit by the foot', 'Other Snack', array['fruit by foot'], 0, true, false, false, false),
  ('Rice Krispies Treats', 'rice krispies treats', 'Other Snack', array['rice krispie treats', 'rice crispy treats'], 0, true, false, false, false),
  ('Water', 'water', 'Water', array['bottled water', 'h20'], 0, true, false, false, false),
  ('Gatorade', 'gatorade', 'Sports Drink', array['gatoraid', 'gatoraide'], 0, true, false, false, false),
  ('Powerade', 'powerade', 'Sports Drink', array['poweraid', 'poweraide'], 0, true, false, false, false),
  ('Juice Boxes', 'juice boxes', 'Other Drink', array['juice box', 'juice pouches'], 0, true, false, false, false),
  ('Iced Tea', 'iced tea', 'Other Drink', array['tea', 'sweet tea'], 0, true, false, false, false),
  ('Lemonade', 'lemonade', 'Other Drink', array['strawberry lemonade'], 0, true, false, false, false)
on conflict (normalized_title) do update
set
  title = excluded.title,
  category = excluded.category,
  aliases = excluded.aliases,
  approved = excluded.approved,
  hidden = false,
  updated_at = now();

create or replace function public.set_admin_passcode(p_passcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if trim(coalesce(p_passcode, '')) = '' then
    raise exception 'Admin passcode cannot be empty.';
  end if;

  insert into public.station_settings (
    singleton_key,
    current_status,
    status_note,
    admin_passcode_hash
  )
  values (
    true,
    'Fresh snacks added today',
    'Live updates appear here after the site is connected.',
    extensions.crypt(p_passcode, extensions.gen_salt('bf'))
  )
  on conflict (singleton_key) do update
  set
    admin_passcode_hash = extensions.crypt(p_passcode, extensions.gen_salt('bf')),
    updated_at = now();
end;
$$;

create or replace function public.admin_passcode_valid(p_passcode text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  select admin_passcode_hash
  into v_hash
  from public.station_settings
  where singleton_key = true
  limit 1;

  if v_hash is null or trim(coalesce(p_passcode, '')) = '' then
    return false;
  end if;

  return extensions.crypt(p_passcode, v_hash) = v_hash;
end;
$$;

create or replace function public.require_admin(p_passcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_passcode_valid(p_passcode) then
    raise exception 'Admin passcode was not accepted.';
  end if;
end;
$$;

create or replace function public.find_snack_matches(p_input text)
returns table (
  snack_id uuid,
  title text,
  category text,
  match_reason text,
  confidence numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate_terms as (
    select
      s.id,
      s.title,
      s.category,
      s.normalized_title,
      term.term_value
    from public.snack_items as s
    cross join lateral unnest(array_append(s.aliases, s.title)) as term(term_value)
    where s.approved = true
      and s.hidden = false
  ),
  scored as (
    select distinct on (id)
      id as snack_id,
      title,
      category,
      case
        when public.normalize_station_text(term_value) = public.normalize_station_text(p_input) then 'exact'
        when similarity(lower(term_value), lower(coalesce(p_input, ''))) >= 0.75 then 'alias'
        else 'fuzzy'
      end as match_reason,
      greatest(
        case
          when public.normalize_station_text(term_value) = public.normalize_station_text(p_input) then 1.0
          else 0.0
        end,
        similarity(lower(term_value), lower(coalesce(p_input, ''))),
        similarity(normalized_title, public.normalize_station_text(p_input))
      ) as confidence
    from candidate_terms
    where public.normalize_station_text(term_value) = public.normalize_station_text(p_input)
       or similarity(lower(term_value), lower(coalesce(p_input, ''))) >= 0.45
       or similarity(normalized_title, public.normalize_station_text(p_input)) >= 0.45
    order by id, confidence desc, title asc
  )
  select
    scored.snack_id,
    scored.title,
    scored.category,
    scored.match_reason,
    round(scored.confidence::numeric, 3) as confidence
  from scored
  order by scored.confidence desc, scored.title asc
  limit 5;
end;
$$;

create or replace function public.submit_snack_feedback(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id text := trim(coalesce(jsonb_extract_path_text(p_payload, 'sessionId'), ''));
  v_selected_snack_ids uuid[] := '{}'::uuid[];
  v_selected_snack_titles text[] := '{}'::text[];
  v_custom_snack_original text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'customSnackOriginal'), '')), '');
  v_custom_snack_normalized text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'customSnackNormalized'), '')), '');
  v_custom_snack_decision text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'customSnackDecision'), '')), '');
  v_matched_snack_id uuid := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'matchedSnackId'), '')), '')::uuid;
  v_preferred_water_brand text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'preferredWaterBrand'), '')), '');
  v_wants_added text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'wantsAdded'), '')), '');
  v_dislikes text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'dislikes'), '')), '');
  v_delivery_frequency text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'deliveryFrequency'), '')), '');
  v_area_delivery text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'areaDelivery'), '')), '');
  v_neighborhood_sighting text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'neighborhoodSighting'), '')), '');
  v_wasilla_sighting text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'wasillaSighting'), '')), '');
  v_message text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'message'), '')), '');
  v_nickname text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'nickname'), '')), '');
  v_submitted_anonymously boolean := case
    when lower(coalesce(jsonb_extract_path_text(p_payload, 'submittedAnonymously'), 'true')) = 'false' then false
    else true
  end;
  v_needs_review boolean := case
    when lower(coalesce(jsonb_extract_path_text(p_payload, 'needsReview'), 'false')) = 'true' then true
    else false
  end;
  v_submission_id uuid;
  v_created_snack_id uuid;
  v_exact_match_id uuid;
  v_fuzzy_match_id uuid;
  v_fuzzy_confidence numeric;
begin
  if v_session_id = '' then
    raise exception 'Session ID is required.';
  end if;

  select
    coalesce(array_agg(item_value::uuid), '{}'::uuid[])
  into v_selected_snack_ids
  from jsonb_array_elements_text(
    coalesce(jsonb_extract_path(p_payload, 'selectedSnackIds'), '[]'::jsonb)
  ) as item(item_value);

  select
    coalesce(array_agg(trim(item_value)), '{}'::text[])
  into v_selected_snack_titles
  from jsonb_array_elements_text(
    coalesce(jsonb_extract_path(p_payload, 'selectedSnackTitles'), '[]'::jsonb)
  ) as item(item_value)
  where trim(coalesce(item_value, '')) <> '';

  if coalesce(array_length(v_selected_snack_titles, 1), 0) = 0 then
    select
      coalesce(array_agg(title order by title), '{}'::text[])
    into v_selected_snack_titles
    from public.snack_items
    where id = any(v_selected_snack_ids);
  end if;

  if coalesce(array_length(v_selected_snack_titles, 1), 0) = 0 and v_custom_snack_original is null and v_preferred_water_brand is null and v_wants_added is null and v_dislikes is null and v_message is null then
    raise exception 'Submission needs at least one snack choice or note.';
  end if;

  if v_delivery_frequency is null or v_delivery_frequency not in ('First time', 'Rarely', 'Sometimes', 'Often', 'I am a regular delivery driver here') then
    v_delivery_frequency := 'First time';
  end if;

  if v_area_delivery is null or v_area_delivery not in ('Temporary', 'Usually deliver in Wasilla', 'Not sure', 'Prefer not to answer') then
    v_area_delivery := 'Not sure';
  end if;

  if v_neighborhood_sighting is null or v_neighborhood_sighting not in ('Yes', 'No', 'Not sure') then
    v_neighborhood_sighting := 'Not sure';
  end if;

  if v_wasilla_sighting is null or v_wasilla_sighting not in ('Yes', 'No', 'Not sure') then
    v_wasilla_sighting := 'Not sure';
  end if;

  if v_custom_snack_original is not null and v_custom_snack_normalized is null then
    v_custom_snack_normalized := public.normalize_station_text(v_custom_snack_original);
  end if;

  if v_custom_snack_normalized is not null then
    select s.id
    into v_exact_match_id
    from public.snack_items as s
    where s.hidden = false
      and (
        s.normalized_title = v_custom_snack_normalized
        or exists (
          select 1
          from unnest(s.aliases) as alias_value
          where public.normalize_station_text(alias_value) = v_custom_snack_normalized
        )
      )
    order by s.approved desc, s.created_at asc
    limit 1;
  end if;

  if v_matched_snack_id is null and v_exact_match_id is not null then
    v_matched_snack_id := v_exact_match_id;
  end if;

  if v_custom_snack_original is not null then
    select
      match_row.snack_id,
      match_row.confidence
    into
      v_fuzzy_match_id,
      v_fuzzy_confidence
    from public.find_snack_matches(v_custom_snack_original) as match_row
    order by match_row.confidence desc, match_row.title asc
    limit 1;

    if v_fuzzy_match_id is not null and v_matched_snack_id is null and v_fuzzy_confidence >= 0.9 then
      v_matched_snack_id := v_fuzzy_match_id;
    end if;

    if v_fuzzy_confidence is not null and v_fuzzy_confidence >= 0.62 and v_custom_snack_decision <> 'matched-existing' then
      v_needs_review := true;
    end if;
  end if;

  if v_custom_snack_original is not null and v_matched_snack_id is null then
    insert into public.snack_items (
      title,
      normalized_title,
      category,
      aliases,
      approved,
      hidden,
      created_by_user,
      needs_review,
      created_by_session_id
    )
    values (
      v_custom_snack_original,
      public.normalize_station_text(v_custom_snack_original),
      'Driver Request',
      '{}'::text[],
      false,
      false,
      true,
      true,
      v_session_id
    )
    on conflict (normalized_title) do update
    set
      needs_review = true,
      updated_at = now()
    returning id into v_created_snack_id;
  end if;

  insert into public.snack_submissions (
    session_id,
    selected_snack_ids,
    selected_snack_titles,
    custom_snack_original,
    custom_snack_normalized,
    matched_snack_id,
    custom_snack_decision,
    preferred_water_brand,
    preferred_water_brand_redacted,
    wants_added,
    wants_added_redacted,
    dislikes,
    dislikes_redacted,
    delivery_frequency,
    area_delivery,
    neighborhood_sighting,
    wasilla_sighting,
    message,
    message_redacted,
    nickname,
    nickname_redacted,
    submitted_anonymously,
    needs_review
  )
  values (
    v_session_id,
    v_selected_snack_ids,
    v_selected_snack_titles,
    v_custom_snack_original,
    v_custom_snack_normalized,
    coalesce(v_matched_snack_id, v_created_snack_id),
    v_custom_snack_decision,
    v_preferred_water_brand,
    public.redact_sensitive_text(v_preferred_water_brand),
    v_wants_added,
    public.redact_sensitive_text(v_wants_added),
    v_dislikes,
    public.redact_sensitive_text(v_dislikes),
    v_delivery_frequency,
    v_area_delivery,
    v_neighborhood_sighting,
    v_wasilla_sighting,
    v_message,
    public.redact_sensitive_text(v_message),
    v_nickname,
    public.redact_sensitive_text(v_nickname),
    coalesce(v_submitted_anonymously, true),
    coalesce(v_needs_review, false)
  )
  returning id into v_submission_id;

  if v_created_snack_id is not null then
    update public.snack_items
    set created_by_submission_id = v_submission_id
    where id = v_created_snack_id
      and created_by_submission_id is null;
  end if;

  if public.redact_sensitive_text(v_message) is not null then
    insert into public.public_comments (
      submission_id,
      nickname,
      comment_text,
      approved,
      hidden
    )
    values (
      v_submission_id,
      coalesce(public.redact_sensitive_text(v_nickname), 'Anonymous driver'),
      public.redact_sensitive_text(v_message),
      false,
      false
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'submissionId', v_submission_id,
    'createdSnackId', v_created_snack_id,
    'matchedSnackId', coalesce(v_matched_snack_id, v_created_snack_id),
    'message', 'Thanks. Your snack note has been saved.'
  );
end;
$$;

create or replace function public.submit_snack_vote(p_snack_id uuid, p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_session_id text;
  v_vote_count integer;
  v_inserted boolean := false;
begin
  if trim(coalesce(p_session_id, '')) = '' then
    raise exception 'Session ID is required for voting.';
  end if;

  select created_by_session_id
  into v_creator_session_id
  from public.snack_items
  where id = p_snack_id
    and approved = true
    and hidden = false
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_found',
      'message', 'That snack is not available for voting.'
    );
  end if;

  if v_creator_session_id is not null and v_creator_session_id = p_session_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'own_snack',
      'message', 'Thanks for the suggestion. You cannot plus one your own snack, but others can vote for it once it is approved.'
    );
  end if;

  insert into public.snack_votes (
    snack_id,
    session_id
  )
  values (
    p_snack_id,
    p_session_id
  )
  on conflict (snack_id, session_id) do nothing;

  if found then
    v_inserted := true;
  end if;

  select vote_count
  into v_vote_count
  from public.snack_items
  where id = p_snack_id;

  if not v_inserted then
    return jsonb_build_object(
      'ok', true,
      'code', 'duplicate',
      'voteCount', coalesce(v_vote_count, 0),
      'message', 'You already used your plus one for that snack.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'success',
    'voteCount', coalesce(v_vote_count, 0),
    'message', 'Your plus one was counted.'
  );
end;
$$;

create or replace function public.get_public_station_snapshot(p_session_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station public.station_settings%rowtype;
  v_snacks jsonb := '[]'::jsonb;
  v_recent_grabs jsonb := '[]'::jsonb;
  v_popular_snacks jsonb := '[]'::jsonb;
  v_requested_snacks jsonb := '[]'::jsonb;
  v_disliked_snacks jsonb := '[]'::jsonb;
  v_comments jsonb := '[]'::jsonb;
  v_sightings jsonb := '{}'::jsonb;
  v_community_stats jsonb := '{}'::jsonb;
begin
  select *
  into v_station
  from public.station_settings
  where singleton_key = true
  limit 1;

  select
    coalesce(
      jsonb_agg(
        snack_json
        order by snack_category, snack_title
      ),
      '[]'::jsonb
    )
  into v_snacks
  from (
    select
      jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'normalizedTitle', s.normalized_title,
        'category', s.category,
        'aliases', s.aliases,
        'voteCount', s.vote_count,
        'approved', s.approved,
        'createdByUser', s.created_by_user,
        'needsReview', s.needs_review,
        'userHasVoted', case
          when trim(coalesce(p_session_id, '')) <> '' and exists (
            select 1
            from public.snack_votes as sv
            where sv.snack_id = s.id
              and sv.session_id = p_session_id
          ) then true
          else false
        end,
        'isOwnSubmission', case
          when trim(coalesce(p_session_id, '')) <> '' and s.created_by_session_id = p_session_id then true
          else false
        end
      ) as snack_json,
      s.category as snack_category,
      s.title as snack_title
    from public.snack_items as s
    where s.approved = true
      and s.hidden = false
  ) as snack_rows;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'title', recent.title,
          'count', recent.total
        )
        order by recent.last_seen desc, recent.total desc, recent.title asc
      ),
      '[]'::jsonb
    )
  into v_recent_grabs
  from (
    select
      snack_title as title,
      count(*)::integer as total,
      max(s.created_at) as last_seen
    from public.snack_submissions as s
    cross join unnest(s.selected_snack_titles) as snack_title
    where s.hidden = false
      and s.created_at >= now() - interval '30 days'
    group by snack_title
    order by last_seen desc, total desc, snack_title asc
    limit 8
  ) as recent;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'title', ranked.title,
          'count', ranked.total
        )
        order by ranked.total desc, ranked.title asc
      ),
      '[]'::jsonb
    )
  into v_popular_snacks
  from (
    with grab_counts as (
      select
        snack_title,
        count(*)::integer as grab_count
      from public.snack_submissions as s
      cross join unnest(s.selected_snack_titles) as snack_title
      where s.hidden = false
      group by snack_title
    )
    select
      s.title,
      coalesce(g.grab_count, 0) + s.vote_count as total
    from public.snack_items as s
    left join grab_counts as g
      on g.snack_title = s.title
    where s.approved = true
      and s.hidden = false
    order by total desc, s.title asc
    limit 8
  ) as ranked;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'title', ranked.display_title,
          'count', ranked.total
        )
        order by ranked.total desc, ranked.display_title asc
      ),
      '[]'::jsonb
    )
  into v_requested_snacks
  from (
    with request_items as (
      select
        min(items.display_text) as display_title,
        items.normalized_text,
        count(*)::integer as total
      from public.snack_submissions as s
      cross join lateral public.split_feedback_items(s.wants_added_redacted) as items
      where s.hidden = false
        and items.normalized_text <> ''
      group by items.normalized_text
    )
    select
      display_title,
      total
    from request_items
    order by total desc, display_title asc
    limit 8
  ) as ranked;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'title', ranked.display_title,
          'count', ranked.total
        )
        order by ranked.total desc, ranked.display_title asc
      ),
      '[]'::jsonb
    )
  into v_disliked_snacks
  from (
    with dislike_items as (
      select
        min(items.display_text) as display_title,
        items.normalized_text,
        count(*)::integer as total
      from public.snack_submissions as s
      cross join lateral public.split_feedback_items(s.dislikes_redacted) as items
      where s.hidden = false
        and items.normalized_text <> ''
      group by items.normalized_text
    )
    select
      display_title,
      total
    from dislike_items
    order by total desc, display_title asc
    limit 8
  ) as ranked;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'nickname', c.nickname,
          'commentText', c.comment_text
        )
        order by c.created_at desc
      ),
      '[]'::jsonb
    )
  into v_comments
  from (
    select
      nickname,
      comment_text,
      created_at
    from public.public_comments
    where approved = true
      and hidden = false
    order by created_at desc
    limit 6
  ) as c;

  select
    jsonb_build_object(
      'neighborhood',
      jsonb_build_object(
        'yes', count(*) filter (where neighborhood_sighting = 'Yes'),
        'no', count(*) filter (where neighborhood_sighting = 'No'),
        'notSure', count(*) filter (where neighborhood_sighting = 'Not sure')
      ),
      'wasilla',
      jsonb_build_object(
        'yes', count(*) filter (where wasilla_sighting = 'Yes'),
        'no', count(*) filter (where wasilla_sighting = 'No'),
        'notSure', count(*) filter (where wasilla_sighting = 'Not sure')
      )
    )
  into v_sightings
  from public.snack_submissions
  where hidden = false;

  select
    jsonb_build_object(
      'totalSubmissions', count(*),
      'totalGrabReports', coalesce(sum(cardinality(selected_snack_titles)), 0),
      'anonymousSubmissions', count(*) filter (where submitted_anonymously = true),
      'regularDrivers', count(*) filter (where delivery_frequency = 'I am a regular delivery driver here'),
      'approvedComments', (
        select count(*)
        from public.public_comments
        where approved = true
          and hidden = false
      )
    )
  into v_community_stats
  from public.snack_submissions
  where hidden = false;

  return jsonb_build_object(
    'stationStatus', coalesce(v_station.current_status, 'Fresh snacks added today'),
    'stationStatusNote', coalesce(v_station.status_note, 'Live updates appear here after the site is connected.'),
    'snacks', v_snacks,
    'recentGrabs', v_recent_grabs,
    'popularSnacks', v_popular_snacks,
    'requestedSnacks', v_requested_snacks,
    'dislikedSnacks', v_disliked_snacks,
    'comments', v_comments,
    'sightings', v_sightings,
    'communityStats', v_community_stats
  );
end;
$$;

create or replace function public.admin_get_dashboard(p_passcode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station public.station_settings%rowtype;
  v_summary jsonb := '{}'::jsonb;
  v_snacks jsonb := '[]'::jsonb;
  v_pending jsonb := '[]'::jsonb;
  v_review jsonb := '[]'::jsonb;
  v_comments jsonb := '[]'::jsonb;
  v_submissions jsonb := '[]'::jsonb;
begin
  perform public.require_admin(p_passcode);

  select *
  into v_station
  from public.station_settings
  where singleton_key = true
  limit 1;

  select
    jsonb_build_object(
      'currentStatus', coalesce(v_station.current_status, ''),
      'approvedSnackCount', count(*) filter (where approved = true and hidden = false),
      'pendingSnackCount', count(*) filter (where approved = false and hidden = false),
      'needsReviewCount', count(*) filter (where needs_review = true and hidden = false),
      'submissionCount', (select count(*) from public.snack_submissions where hidden = false),
      'pendingCommentCount', (select count(*) from public.public_comments where approved = false and hidden = false)
    )
  into v_summary
  from public.snack_items;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'normalizedTitle', s.normalized_title,
          'category', s.category,
          'aliases', s.aliases,
          'voteCount', s.vote_count,
          'approved', s.approved,
          'hidden', s.hidden,
          'createdByUser', s.created_by_user,
          'needsReview', s.needs_review,
          'createdAt', s.created_at,
          'updatedAt', s.updated_at
        )
        order by s.approved desc, s.hidden asc, s.created_at desc
      ),
      '[]'::jsonb
    )
  into v_snacks
  from public.snack_items as s;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'normalizedTitle', s.normalized_title,
          'category', s.category,
          'aliases', s.aliases,
          'voteCount', s.vote_count,
          'approved', s.approved,
          'hidden', s.hidden,
          'createdByUser', s.created_by_user,
          'needsReview', s.needs_review,
          'createdAt', s.created_at,
          'updatedAt', s.updated_at
        )
        order by s.created_at desc
      ),
      '[]'::jsonb
    )
  into v_pending
  from public.snack_items as s
  where s.approved = false
    and s.hidden = false;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'normalizedTitle', s.normalized_title,
          'category', s.category,
          'aliases', s.aliases,
          'voteCount', s.vote_count,
          'approved', s.approved,
          'hidden', s.hidden,
          'createdByUser', s.created_by_user,
          'needsReview', s.needs_review,
          'createdAt', s.created_at,
          'updatedAt', s.updated_at
        )
        order by s.created_at desc
      ),
      '[]'::jsonb
    )
  into v_review
  from public.snack_items as s
  where s.needs_review = true
    and s.hidden = false;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'nickname', c.nickname,
          'commentText', c.comment_text,
          'approved', c.approved,
          'hidden', c.hidden,
          'createdAt', c.created_at
        )
        order by c.created_at desc
      ),
      '[]'::jsonb
    )
  into v_comments
  from public.public_comments as c;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'selectedSnackIds', s.selected_snack_ids,
          'selectedSnackTitles', s.selected_snack_titles,
          'customSnackOriginal', s.custom_snack_original,
          'preferredWaterBrand', s.preferred_water_brand,
          'wantsAdded', s.wants_added,
          'dislikes', s.dislikes,
          'deliveryFrequency', s.delivery_frequency,
          'areaDelivery', s.area_delivery,
          'neighborhoodSighting', s.neighborhood_sighting,
          'wasillaSighting', s.wasilla_sighting,
          'message', s.message,
          'nickname', s.nickname,
          'needsReview', s.needs_review,
          'createdAt', s.created_at
        )
        order by s.created_at desc
      ),
      '[]'::jsonb
    )
  into v_submissions
  from (
    select *
    from public.snack_submissions
    order by created_at desc
    limit 150
  ) as s;

  return jsonb_build_object(
    'stationStatus', coalesce(v_station.current_status, ''),
    'summary', v_summary,
    'snacks', v_snacks,
    'pendingSnacks', v_pending,
    'needsReviewSnacks', v_review,
    'comments', v_comments,
    'submissions', v_submissions
  );
end;
$$;

create or replace function public.admin_update_station_status(p_passcode text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin(p_passcode);

  update public.station_settings
  set
    current_status = trim(coalesce(p_status, '')),
    updated_at = now()
  where singleton_key = true;

  return jsonb_build_object(
    'ok', true,
    'status', trim(coalesce(p_status, ''))
  );
end;
$$;

create or replace function public.admin_update_snack(
  p_passcode text,
  p_snack_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'title'), '')), '');
  v_category text := nullif(trim(coalesce(jsonb_extract_path_text(p_payload, 'category'), '')), '');
  v_aliases text[] := '{}'::text[];
  v_has_aliases boolean := jsonb_extract_path(p_payload, 'aliases') is not null;
  v_needs_review boolean := case
    when lower(coalesce(jsonb_extract_path_text(p_payload, 'needsReview'), 'false')) = 'true' then true
    else false
  end;
begin
  perform public.require_admin(p_passcode);

  if v_has_aliases then
    select
      coalesce(array_agg(trim(item_value) order by trim(item_value)), '{}'::text[])
    into v_aliases
    from jsonb_array_elements_text(
      coalesce(jsonb_extract_path(p_payload, 'aliases'), '[]'::jsonb)
    ) as alias_item(item_value)
    where trim(item_value) <> '';
  end if;

  if p_action = 'approve' then
    update public.snack_items
    set
      approved = true,
      hidden = false,
      needs_review = false
    where id = p_snack_id;
  elsif p_action = 'hide' then
    update public.snack_items
    set hidden = true
    where id = p_snack_id;
  elsif p_action = 'delete' then
    delete from public.snack_items
    where id = p_snack_id;
  elsif p_action = 'review' then
    update public.snack_items
    set needs_review = v_needs_review
    where id = p_snack_id;
  elsif p_action = 'save_meta' then
    update public.snack_items
    set
      title = coalesce(v_title, title),
      normalized_title = case
        when v_title is not null then public.normalize_station_text(v_title)
        else normalized_title
      end,
      category = coalesce(v_category, category),
      aliases = case
        when v_has_aliases then v_aliases
        else aliases
      end
    where id = p_snack_id;
  else
    raise exception 'Unsupported snack action.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', p_action,
    'snackId', p_snack_id
  );
end;
$$;

create or replace function public.admin_merge_snacks(
  p_passcode text,
  p_source_snack_id uuid,
  p_target_snack_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_title text;
  v_source_approved boolean;
  v_merged_aliases text[] := '{}'::text[];
begin
  perform public.require_admin(p_passcode);

  if p_source_snack_id = p_target_snack_id then
    raise exception 'Source and target snacks must be different.';
  end if;

  select
    title,
    approved
  into
    v_source_title,
    v_source_approved
  from public.snack_items
  where id = p_source_snack_id;

  if v_source_title is null then
    raise exception 'Source snack was not found.';
  end if;

  select
    coalesce(array_agg(distinct alias_text order by alias_text), '{}'::text[])
  into v_merged_aliases
  from (
    select trim(alias_value) as alias_text
    from (
      select unnest(aliases) as alias_value
      from public.snack_items
      where id = p_target_snack_id

      union all

      select unnest(aliases) as alias_value
      from public.snack_items
      where id = p_source_snack_id

      union all

      select v_source_title
    ) as merged_alias_source
    where trim(alias_value) <> ''
  ) as merged_aliases;

  insert into public.snack_votes (
    snack_id,
    session_id,
    created_at
  )
  select
    p_target_snack_id,
    session_id,
    min(created_at)
  from public.snack_votes
  where snack_id in (p_source_snack_id, p_target_snack_id)
  group by session_id
  on conflict (snack_id, session_id) do nothing;

  delete from public.snack_votes
  where snack_id = p_source_snack_id;

  update public.snack_submissions
  set matched_snack_id = p_target_snack_id
  where matched_snack_id = p_source_snack_id;

  update public.snack_items
  set
    aliases = v_merged_aliases,
    approved = approved or coalesce(v_source_approved, false),
    hidden = false,
    needs_review = false
  where id = p_target_snack_id;

  delete from public.snack_items
  where id = p_source_snack_id;

  perform public.refresh_snack_vote_count(p_target_snack_id);

  return jsonb_build_object(
    'ok', true,
    'sourceSnackId', p_source_snack_id,
    'targetSnackId', p_target_snack_id
  );
end;
$$;

create or replace function public.admin_update_comment(
  p_passcode text,
  p_comment_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin(p_passcode);

  if p_action = 'approve' then
    update public.public_comments
    set
      approved = true,
      hidden = false
    where id = p_comment_id;
  elsif p_action = 'hide' then
    update public.public_comments
    set hidden = true
    where id = p_comment_id;
  elsif p_action = 'delete' then
    delete from public.public_comments
    where id = p_comment_id;
  else
    raise exception 'Unsupported comment action.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'commentId', p_comment_id,
    'action', p_action
  );
end;
$$;

create or replace function public.admin_delete_submission(
  p_passcode text,
  p_submission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin(p_passcode);

  delete from public.snack_submissions
  where id = p_submission_id;

  return jsonb_build_object(
    'ok', true,
    'submissionId', p_submission_id
  );
end;
$$;

revoke all on public.station_settings from anon, authenticated;
revoke all on public.snack_items from anon, authenticated;
revoke all on public.snack_submissions from anon, authenticated;
revoke all on public.public_comments from anon, authenticated;
revoke all on public.snack_votes from anon, authenticated;

alter table public.station_settings enable row level security;
alter table public.snack_items enable row level security;
alter table public.snack_submissions enable row level security;
alter table public.public_comments enable row level security;
alter table public.snack_votes enable row level security;

revoke all on function public.normalize_station_text(text) from public, anon, authenticated;
revoke all on function public.redact_sensitive_text(text) from public, anon, authenticated;
revoke all on function public.split_feedback_items(text) from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.refresh_snack_vote_count(uuid) from public, anon, authenticated;
revoke all on function public.handle_snack_vote_change() from public, anon, authenticated;
revoke all on function public.set_admin_passcode(text) from public, anon, authenticated;
revoke all on function public.admin_passcode_valid(text) from public, anon, authenticated;
revoke all on function public.require_admin(text) from public, anon, authenticated;

grant execute on function public.find_snack_matches(text) to anon, authenticated;
grant execute on function public.submit_snack_feedback(jsonb) to anon, authenticated;
grant execute on function public.submit_snack_vote(uuid, text) to anon, authenticated;
grant execute on function public.get_public_station_snapshot(text) to anon, authenticated;
grant execute on function public.admin_get_dashboard(text) to anon, authenticated;
grant execute on function public.admin_update_station_status(text, text) to anon, authenticated;
grant execute on function public.admin_update_snack(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.admin_merge_snacks(text, uuid, uuid) to anon, authenticated;
grant execute on function public.admin_update_comment(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_delete_submission(text, uuid) to anon, authenticated;

comment on table public.station_settings is 'Single row table for the public station status and the hashed admin passcode.';
comment on table public.snack_items is 'Approved and pending snack choices, aliases, review flags, and anonymous vote totals.';
comment on table public.snack_submissions is 'Private driver feedback with public-safe redacted columns for aggregated reporting.';
comment on table public.snack_votes is 'Anonymous plus one votes limited by snack and session.';
comment on table public.public_comments is 'Redacted driver messages that can be approved for public display.';

comment on function public.get_public_station_snapshot(text) is 'Public JSON snapshot for the driver page. This keeps raw table access private.';
comment on function public.submit_snack_feedback(jsonb) is 'Creates a private submission record, optional pending snack, and optional moderated public comment.';
comment on function public.submit_snack_vote(uuid, text) is 'Adds one anonymous vote per snack and session while blocking self votes.';
comment on function public.admin_get_dashboard(text) is 'Returns a passcode-gated admin JSON snapshot for moderation and export.';

-- Run this once after the rest of the script:
-- select public.set_admin_passcode('replace-this-passcode');

-- RLS recommendations:
-- 1. Keep direct table access locked down and use the RPC functions above from the public site.
-- 2. Move the admin page to real Supabase Auth before serious use.
-- 3. Rotate the admin passcode whenever it is shared with a new person.
-- 4. Consider adding rate limits with Supabase Edge Functions if traffic grows.
