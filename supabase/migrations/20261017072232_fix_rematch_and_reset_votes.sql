do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.game_action(text,jsonb)'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    $$if v_room.phase <> 'lobby' then raise exception 'Game already started'; end if;$$,
    $$if v_room.phase not in ('lobby','results') then raise exception 'Game already started'; end if;$$
  );
  if v_updated = v_definition then
    raise exception 'Could not patch start_game phase guard; migration stopped safely';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $$update private.players set role='crew',word=v_secret,alive=true,has_clued=false,clue=null where room_id=v_room.id;$$,
    $$delete from private.votes where room_id=v_room.id;
    update private.players set role='crew',word=v_secret,alive=true,has_clued=false,clue=null where room_id=v_room.id;$$
  );
  if v_updated = v_definition then
    raise exception 'Could not add vote cleanup; migration stopped safely';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $$update private.rooms set phase='clue',round_no=1,impostor_count=v_impostors,$$,
    $$update private.rooms set phase='clue',round_no=case when v_room.phase='results' then v_room.round_no+1 else 1 end,impostor_count=v_impostors,$$
  );
  if v_updated = v_definition then
    raise exception 'Could not patch round counter; migration stopped safely';
  end if;

  execute v_updated;
end
$migration$;
