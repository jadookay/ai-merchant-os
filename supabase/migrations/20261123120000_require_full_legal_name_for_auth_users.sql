-- Require a complete, user-declared legal name when a new Auth identity is created.
-- Existing accounts are not rewritten; staff updates may preserve an unchanged legacy name.

create or replace function public.is_valid_full_legal_name(p_name text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  normalized_name text;
  name_parts text[];
  name_part text;
begin
  normalized_name := normalize(
    regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'),
    NFC
  );
  if char_length(normalized_name) < 3 or char_length(normalized_name) > 120 then
    return false;
  end if;
  name_parts := regexp_split_to_array(normalized_name, ' ');
  if coalesce(array_length(name_parts, 1), 0) < 2 then
    return false;
  end if;
  foreach name_part in array name_parts loop
    if name_part !~ $re$^[[:alpha:]]([[:alpha:]]|['’.-][[:alpha:]])*\.?$re$ then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.enforce_full_legal_name_on_auth_user()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  candidate_name text;
begin
  candidate_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
  );
  if not public.is_valid_full_legal_name(candidate_name) then
    raise exception using
      errcode = '22023',
      message = 'A full legal name with at least two name parts (3–120 characters) is required to create an account.';
  end if;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'full_name',
      normalize(regexp_replace(btrim(candidate_name), '[[:space:]]+', ' ', 'g'), NFC)
    );
  return new;
end;
$$;

revoke all on function public.is_valid_full_legal_name(text) from public, anon, authenticated;
revoke all on function public.enforce_full_legal_name_on_auth_user() from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.is_valid_full_legal_name(text) to supabase_auth_admin;
grant execute on function public.enforce_full_legal_name_on_auth_user() to supabase_auth_admin;

drop trigger if exists require_full_legal_name_on_auth_user on auth.users;
create trigger require_full_legal_name_on_auth_user
before insert on auth.users
for each row
execute function public.enforce_full_legal_name_on_auth_user();
