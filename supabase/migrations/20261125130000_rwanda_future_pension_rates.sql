-- Future mandatory pension rates under Rwanda Presidential Order No. 086/01.
-- Rates are effective-dated and split equally between employee and employer.
insert into public.payroll_rule_sets
  (jurisdiction,rule_code,display_name,effective_from,configuration,source_url,verification_status)
values
 ('RW','RSSB_PENSION','Mandatory pension contribution - 2027 rate','2027-01-01',
  '{"employee_rate":0.07,"employer_rate":0.07,"total_rate":0.14,"base":"gross_remuneration_including_transport_allowance","declaration_frequency":"monthly"}'::jsonb,
  'https://www.rssb.rw/uploads/OG_n_Special_of_13_12_2024_Ingano_y_umusanzu_mu_bwiteganyirize_bwa_pansiyo_butegetswe_910c736b90.pdf','verified'),
 ('RW','RSSB_PENSION','Mandatory pension contribution - 2028 rate','2028-01-01',
  '{"employee_rate":0.08,"employer_rate":0.08,"total_rate":0.16,"base":"gross_remuneration_including_transport_allowance","declaration_frequency":"monthly"}'::jsonb,
  'https://www.rssb.rw/uploads/OG_n_Special_of_13_12_2024_Ingano_y_umusanzu_mu_bwiteganyirize_bwa_pansiyo_butegetswe_910c736b90.pdf','verified'),
 ('RW','RSSB_PENSION','Mandatory pension contribution - 2029 rate','2029-01-01',
  '{"employee_rate":0.09,"employer_rate":0.09,"total_rate":0.18,"base":"gross_remuneration_including_transport_allowance","declaration_frequency":"monthly"}'::jsonb,
  'https://www.rssb.rw/uploads/OG_n_Special_of_13_12_2024_Ingano_y_umusanzu_mu_bwiteganyirize_bwa_pansiyo_butegetswe_910c736b90.pdf','verified'),
 ('RW','RSSB_PENSION','Mandatory pension contribution - 2030 rate','2030-01-01',
  '{"employee_rate":0.10,"employer_rate":0.10,"total_rate":0.20,"base":"gross_remuneration_including_transport_allowance","declaration_frequency":"monthly"}'::jsonb,
  'https://www.rssb.rw/uploads/OG_n_Special_of_13_12_2024_Ingano_y_umusanzu_mu_bwiteganyirize_bwa_pansiyo_butegetswe_910c736b90.pdf','verified')
on conflict (jurisdiction,rule_code,effective_from) do nothing;
