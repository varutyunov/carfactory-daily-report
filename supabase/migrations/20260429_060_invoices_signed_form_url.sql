-- Invoice form: require a photo of the signed invoice before save (mirrors
-- the deposit form pattern). The app uploads the photo to storage and stores
-- the URL on the invoices row so it's recoverable later.

alter table invoices add column if not exists signed_form_url text;

comment on column invoices.signed_form_url is
  'Public URL to the photo of the customer-signed invoice taken at save time. '
  'Required by the app — Save button is disabled until the photo is captured.';
