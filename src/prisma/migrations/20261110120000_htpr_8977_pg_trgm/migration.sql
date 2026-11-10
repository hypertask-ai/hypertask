-- HTPR-8977: trigram operators let an index serve the case-insensitive
-- ticket number match that agents send on almost every call.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
