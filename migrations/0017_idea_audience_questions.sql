-- Bounded examples of questions in public comments. Never factual claims,
-- demand volume, comment-author identity, or personal account data.
CREATE TABLE idea_market_audience_questions (
    run_id TEXT NOT NULL REFERENCES idea_market_runs(id) ON DELETE CASCADE,
    comment_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    question TEXT NOT NULL CHECK(length(question) BETWEEN 10 AND 240),
    observed_at INTEGER NOT NULL,
    PRIMARY KEY(run_id,comment_id)
) STRICT;
