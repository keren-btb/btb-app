-- 2026-11-26: bookings safety copy (edge function bookings-safety-copy v1.0.0).
-- Called hourly; the function only sends at 7am and 1pm NZ (booking config key safetyCopyHours,
-- extra addresses in safetyCopyExtraTo, default the BtB Gmail). Applied as migration bookings_safety_copy_cron.
select cron.schedule('bookings-safety-copy', '10 * * * *', $$
  select net.http_post(
    url := 'https://dcksohetvlonijtcbjwe.supabase.co/functions/v1/bookings-safety-copy',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);
