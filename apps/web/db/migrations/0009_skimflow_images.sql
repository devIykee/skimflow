-- Picture Skim-Flow (§5): each image is one chunk row (block_index = position,
-- block 0 = the free first image). The image link and optional caption live on
-- the chunk so the whole pay-per-block unlock/ledger/lock machinery is reused
-- as-is. text stays NOT NULL (we store the caption or "" there too for search).
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS caption   TEXT;
