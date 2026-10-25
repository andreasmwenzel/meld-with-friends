-- A stale tick is an expected no-op. Do not raise a retryable transaction error.
create or replace function public.commit_bot_action(p_game uuid,p_old_rev integer,p_state jsonb,p_action jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare tid uuid; next_rev integer := p_old_rev+1;
begin
 select table_id into tid from public.games where id=p_game;
 if not exists(select 1 from public.seats where table_id=tid and seat=(p_action->>'seat')::integer and bot is not null and user_id is null) then raise exception 'Seat is not a bot' using errcode='42501'; end if;
 if (p_state->>'rev')::integer is distinct from next_rev then raise exception 'Invalid revision' using errcode='22023'; end if;
 update public.games set state=p_state,rev=next_rev,updated_at=now() where id=p_game and rev=p_old_rev;
 if not found then return null; end if;
 insert into public.game_actions(game_id,seat,action,rev) values(p_game,(p_action->>'seat')::integer,p_action,next_rev);
 if p_state->>'phase'='game_over' then update public.tables set status='finished' where id=tid; end if;
 return next_rev;
end $$;
