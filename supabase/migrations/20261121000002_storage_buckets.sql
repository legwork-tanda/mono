-- Photo storage. Public read so <img> tags work without signed URLs in the demo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('job-photos', 'job-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('review-photos', 'review-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;
