-- RevFlow administration and billing are separate from merchants' sales data.
-- This schema is not exposed by PostgREST. Only narrowly scoped RPCs are public.
begin;
create schema if not exists revflow_private;
revoke all on schema revflow_private from public, anon, authenticated;
create table revflow_private.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin')),
  complimentary boolean not null default false,
  customer_id text unique,
  subscription_id text unique,
  plan text check (plan in ('monthly','quarterly','yearly')),
  status text not null default 'none',
  paid_until timestamptz,
  cancel_at_period_end boolean not null default false,
  snapshot_at timestamptz,
  checkout_token uuid,
  checkout_locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table revflow_private.stripe_events (id text primary key, created_at timestamptz not null default now());
create table revflow_private.contact_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
  name text not null, email text not null, subject text not null, message text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);
create table revflow_private.request_limits (key text primary key, hits integer not null, window_start timestamptz not null);
create table revflow_private.admin_audit (
  id uuid primary key default gen_random_uuid(), actor uuid references auth.users(id) on delete set null,
  target uuid, action text not null, created_at timestamptz not null default now()
);
alter table revflow_private.memberships enable row level security;
alter table revflow_private.stripe_events enable row level security;
alter table revflow_private.contact_requests enable row level security;
alter table revflow_private.request_limits enable row level security;
alter table revflow_private.admin_audit enable row level security;
revoke all on all tables in schema revflow_private from public, anon, authenticated;

-- Preserve the accounts that existed before the public paid launch.
insert into revflow_private.memberships(user_id, complimentary) select id, true from auth.users;
update revflow_private.memberships set role = 'admin' where user_id in (
 '7a1f9015-64dc-4af4-89cd-a92bf67118bf'::uuid,
 '053b4104-0388-4d7c-b9fc-756a275c52ea'::uuid
);

create function public.revflow_has_access() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from revflow_private.memberships m where m.user_id = (select auth.uid())
 and (m.role = 'admin' or m.complimentary or (m.status = 'active' and m.paid_until > now())));
$$;
revoke all on function public.revflow_has_access() from public, anon;
grant execute on function public.revflow_has_access() to authenticated, service_role;

create function public.revflow_my_access() returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce((select jsonb_build_object('role',m.role,'complimentary',m.complimentary,'plan',m.plan,'status',m.status,
 'paid_until',m.paid_until,'cancel_at_period_end',m.cancel_at_period_end,'has_access',public.revflow_has_access())
 from revflow_private.memberships m where m.user_id = (select auth.uid())),
 '{"role":"member","complimentary":false,"status":"none","has_access":false}'::jsonb);
$$;
revoke all on function public.revflow_my_access() from public, anon;
grant execute on function public.revflow_my_access() to authenticated, service_role;

-- Restrictive policies compose with the existing ownership policies; an admin
-- does not gain access to another merchant's financial tables.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename not in ('profiles','settings') loop
  execute format('create policy revflow_subscription_access on public.%I as restrictive for all to authenticated using ((select public.revflow_has_access())) with check ((select public.revflow_has_access()))', t.tablename);
 end loop;
end $$;

create function public.revflow_account(p_user_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 insert into revflow_private.memberships(user_id) values(p_user_id) on conflict do nothing;
 return (select to_jsonb(m) from revflow_private.memberships m where user_id=p_user_id);
end $$;
create function public.revflow_customer_account(p_customer text) returns jsonb language sql stable security definer set search_path = '' as $$
 select to_jsonb(m) from revflow_private.memberships m where customer_id=p_customer;
$$;
create function public.revflow_set_customer(p_user_id uuid,p_customer text) returns text language plpgsql security definer set search_path = '' as $$
declare result text; begin
 update revflow_private.memberships set customer_id=coalesce(customer_id,p_customer) where user_id=p_user_id returning customer_id into result;
 return result;
end $$;
create function public.revflow_checkout_lock(p_user_id uuid,p_token uuid,p_release boolean default false) returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if p_release then
  update revflow_private.memberships set checkout_token=null, checkout_locked_until=null where user_id=p_user_id and checkout_token=p_token;
 else
  update revflow_private.memberships set checkout_token=p_token,checkout_locked_until=now()+interval '2 minutes'
   where user_id=p_user_id and (checkout_locked_until is null or checkout_locked_until<now());
 end if;
 return found;
end $$;
create function public.revflow_apply_subscription(p_user_id uuid,p_event text,p_snapshot timestamptz,p_subscription text,p_plan text,p_status text,p_paid_until timestamptz,p_cancel boolean) returns boolean language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from revflow_private.memberships where user_id=p_user_id for update;
 insert into revflow_private.stripe_events(id) values(p_event) on conflict do nothing;
 if not found then return false; end if;
 update revflow_private.memberships set subscription_id=p_subscription,plan=p_plan,status=p_status,paid_until=p_paid_until,
 cancel_at_period_end=p_cancel,snapshot_at=p_snapshot where user_id=p_user_id and (snapshot_at is null or snapshot_at<=p_snapshot);
 delete from revflow_private.stripe_events where created_at < now()-interval '90 days';
 return found;
end $$;
create function public.revflow_admin_overview() returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'name',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name'),'role',coalesce(m.role,'member'),'complimentary',coalesce(m.complimentary,false),'plan',m.plan,'status',coalesce(m.status,'none'),'paid_until',m.paid_until,'cancel_at_period_end',coalesce(m.cancel_at_period_end,false)) order by m.created_at desc),'[]'::jsonb) from auth.users u left join revflow_private.memberships m on m.user_id=u.id),
 'contacts',(select coalesce(jsonb_agg(c order by c.created_at desc),'[]'::jsonb) from (select id,name,email,subject,message,status,created_at from revflow_private.contact_requests order by created_at desc limit 100) c),
 'audit',(select coalesce(jsonb_agg(a order by a.created_at desc),'[]'::jsonb) from (select actor,target,action,created_at from revflow_private.admin_audit order by created_at desc limit 30) a));
$$;
create function public.revflow_admin_update(p_actor uuid,p_target uuid,p_action text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from revflow_private.memberships where user_id=p_actor and role='admin') then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_action in ('grant_access','revoke_access') then
  if exists(select 1 from revflow_private.memberships where user_id=p_target and role='admin') then raise exception 'Admin access is protected'; end if;
  insert into revflow_private.memberships(user_id,complimentary) values(p_target,p_action='grant_access')
   on conflict(user_id) do update set complimentary=excluded.complimentary;
 elsif p_action='resolve_contact' then
  update revflow_private.contact_requests set status='resolved' where id=p_target;
 else raise exception 'Invalid action'; end if;
 insert into revflow_private.admin_audit(actor,target,action) values(p_actor,p_target,p_action);
end $$;
create function public.revflow_rate_limit(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer; begin
 insert into revflow_private.request_limits as r(key,hits,window_start) values(p_key,1,now())
 on conflict(key) do update set hits=case when r.window_start < now()-make_interval(secs=>p_seconds) then 1 else r.hits+1 end,
 window_start=case when r.window_start < now()-make_interval(secs=>p_seconds) then now() else r.window_start end returning hits into n;
 delete from revflow_private.request_limits where window_start<now()-interval '2 days';
 return n<=p_limit;
end $$;
create function public.revflow_contact(p_user_id uuid,p_name text,p_email text,p_subject text,p_message text) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; begin
 if length(p_name) not between 1 and 100 or length(p_email)>254 or length(p_subject)>100 or length(p_message) not between 20 and 4000 then raise exception 'Invalid request'; end if;
 insert into revflow_private.contact_requests(user_id,name,email,subject,message) values(p_user_id,p_name,p_email,p_subject,p_message) returning id into result;
 return result;
end $$;
-- Every function that can read all users or mutate billing is service-only.
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'revflow_%' and proname not in ('revflow_has_access','revflow_my_access') loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
