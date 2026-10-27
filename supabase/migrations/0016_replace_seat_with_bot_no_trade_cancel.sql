-- Seat trades only exist on open tables: offer_seat_trade and answer_seat_trade reject any other
-- status, and start_game cancels pending offers as it starts play. replace_seat_with_bot only runs
-- mid-game, so its cancel of pending trades never matched anything. Same function, without it.
create or replace function public.replace_seat_with_bot(p_table uuid,p_seat integer) returns void
language plpgsql security definer set search_path='' as $$
declare chosen text;
begin
 if p_seat is null or p_seat not between 0 and 3 then raise exception 'Invalid seat' using errcode='22023'; end if;
 if not exists(select 1 from public.seats where table_id=p_table and seat=p_seat and user_id is not null) then raise exception 'No human in that seat' using errcode='22023'; end if;
 select name into chosen from unnest(array['Mabel','Otto','Pearl','Gus','Hazel','Walt']) with ordinality as names(name,ord)
 where not exists(select 1 from public.seats where table_id=p_table and bot=name) order by ord limit 1;
 update public.seats set user_id=null,bot=chosen where table_id=p_table and seat=p_seat;
 if not exists(select 1 from public.seats where table_id=p_table and user_id is not null) then
  update public.tables set status='finished' where id=p_table;
 end if;
end $$;
