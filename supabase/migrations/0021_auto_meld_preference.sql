-- A player's automatic-meld choice, so a leisurely table can lay down their meld while they are away.
-- Browsers report it with the seen revision; a player who never has keeps the default, which is on.
alter table public.profiles add column auto_meld boolean not null default true;
