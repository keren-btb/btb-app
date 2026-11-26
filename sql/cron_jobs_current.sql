-- All scheduled (pg_cron) jobs as they stand on 2026-11-26. Kept here because the nightly database
-- backup (btb-backups) does not include the cron schema. To rebuild a lost project: create the vault
-- secret 'service_role_key' (the project's service role key), then run this file.
-- The Bearer token in the two older jobs is the PUBLIC (anon) key, which is already in the web pages.
-- Update this file whenever a cron job is added or changed.

select cron.schedule('booking-request-check', '20 * * * *', $$
  select net.http_post(
    url := 'https://dcksohetvlonijtcbjwe.supabase.co/functions/v1/booking-request',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
    body := '{"action":"check"}'::jsonb);
$$);

select cron.schedule('bookings-safety-copy', '10 * * * *', $$
  select net.http_post(
    url := 'https://dcksohetvlonijtcbjwe.supabase.co/functions/v1/bookings-safety-copy',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);

select cron.schedule('cleanup-task-photos-daily', '0 3 * * *', $$
  SELECT net.http_post(
    url := 'https://dcksohetvlonijtcbjwe.supabase.co/functions/v1/cleanup-task-photos',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRja3NvaGV0dmxvbmlqdGNiandlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NTQ1NzgsImV4cCI6MjA5NjQzMDU3OH0.M_oDB2e0upZUYZijNmigsmXtcKaAFx8iF-nn5FZUkzk',
      'Content-Type', 'application/json'
    )
  );
$$);

select cron.schedule('sync-calendar-availability', '*/20 * * * *', $$
  SELECT net.http_post(
    url := 'https://dcksohetvlonijtcbjwe.supabase.co/functions/v1/sync-calendar-availability',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRja3NvaGV0dmxvbmlqdGNiandlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NTQ1NzgsImV4cCI6MjA5NjQzMDU3OH0.M_oDB2e0upZUYZijNmigsmXtcKaAFx8iF-nn5FZUkzk',
      'Content-Type', 'application/json'
    )
  );
$$);

select cron.schedule('weekly-availability-email', '5 * * * *', $$
  select net.http_post(
    url := 'https://dcksohetvlonijtcbjwe.supabase.co/functions/v1/weekly-availability-email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
    body := '{}'::jsonb
  );
$$);
