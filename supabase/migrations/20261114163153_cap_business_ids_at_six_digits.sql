-- Keep future Shericeri business IDs within the six-digit range.
alter sequence public.shericeri_id_seq
  minvalue 100000
  maxvalue 999999
  start with 100015
  restart with 100015;
