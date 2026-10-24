-- Maintain an exact full-text index over persisted, immutable source passages.
-- Rebuild indexes passages written before this migration; never ingest fixture
-- documents into a real user's database.
CREATE VIRTUAL TABLE evidence_passages_fts USING fts5(
    body,
    content = 'source_passages',
    content_rowid = 'rowid',
    tokenize = 'unicode61'
);

INSERT INTO evidence_passages_fts(evidence_passages_fts) VALUES ('rebuild');

CREATE TRIGGER source_passages_fts_insert AFTER INSERT ON source_passages BEGIN
    INSERT INTO evidence_passages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
