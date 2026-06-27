-- Add document_urls array column to shipments for multiple PDF attachments
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS document_urls TEXT[] NOT NULL DEFAULT '{}';

-- Create storage bucket for shipment documents (public, PDF only, 10 MB max per file)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shipment-documents',
  'shipment-documents',
  true,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Allow all operations on the bucket (same pattern as other tables in this project)
CREATE POLICY "Allow all on shipment-documents"
  ON storage.objects
  FOR ALL
  USING  (bucket_id = 'shipment-documents')
  WITH CHECK (bucket_id = 'shipment-documents');
