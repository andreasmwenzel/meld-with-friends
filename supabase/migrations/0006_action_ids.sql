begin;
alter table public.game_actions add column request_id text;
create unique index game_actions_request_id_unique on public.game_actions(request_id) where request_id is not null;
drop function public.commit_game_action(uuid,uuid,integer,jsonb,jsonb);
create function public.commit_game_action(p_game uuid,p_user uuid,p_old_rev integer,p_state jsonb,p_action jsonb,p_request_id text) returns integer language plpgsql security definer set search_path='' as $$
declare next_rev integer := p_old_rev+1; g public.games;
begin
 select * into g from public.games where id=p_game for update;
 if not exists(select 1 from public.seats where table_id=g.table_id and user_id=p_user and seat=(p_action->>'seat')::integer) then raise exception 'Action seat does not belong to you' using errcode='42501'; end if;
 if exists(select 1 from public.game_actions where game_id=p_game and request_id=p_request_id) then return null; end if;
 if g.rev is distinct from p_old_rev then raise exception 'Game changed; refresh and retry' using errcode='40001'; end if;
 if (p_state->>'rev')::integer is distinct from next_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 update public.games set state=p_state,rev=next_rev,updated_at=now() where id=p_game;
 insert into public.game_actions(game_id,seat,action,rev,request_id) values(p_game,(p_action->>'seat')::integer,p_action,next_rev,p_request_id);
 if p_state->>'phase'='game_over' then update public.tables set status='finished' where id=g.table_id; end if;
 return next_rev;
end $$;
revoke all on function public.commit_game_action(uuid,uuid,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.commit_game_action(uuid,uuid,integer,jsonb,jsonb,text) to service_role;
commit;
