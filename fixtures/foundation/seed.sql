-- Deterministic local fixture for migration 0001.
-- No network access, models or external services are required.
-- IDs are stable so downstream tests can assert exact rows.

INSERT INTO artifact_manifests (
    id, schema_version, digest_algorithm, digest, size_bytes, media_type,
    producer_kind, producer_name, producer_version, metadata_schema_version,
    metadata_json, created_at
) VALUES (
    'art_foundation_sample_v1', 1, 'sha256',
    '1fc12c76bb932174340a43a784aba075d7a25b59e6772e9999a818eb75aae7a3',
    35, 'text/plain', 'tool', 'content-gen-foundation-fixture', '1', 1,
    '{"fixture":"foundation-v1"}', '2026-10-21T00:00:00Z'
);

INSERT INTO source_records (
    id, schema_version, source_kind, canonical_uri, title, publisher,
    rights_status, metadata_schema_version, metadata_json, created_at
) VALUES (
    'src_house_cost_fixture', 1, 'test',
    'fixture://foundation/house-cost-notes.txt',
    'Illustrative house cost assumptions', 'ContentGen fixtures', 'cleared', 1,
    '{"fixture":"foundation-v1"}', '2026-10-21T00:00:00Z'
);

INSERT INTO source_versions (
    id, schema_version, source_id, content_sha256, retrieved_at, media_type,
    byte_size, parser_version, raw_artifact_id, metadata_schema_version,
    metadata_json, created_at
) VALUES (
    'srcv_house_cost_fixture_1', 1, 'src_house_cost_fixture',
    '1fc12c76bb932174340a43a784aba075d7a25b59e6772e9999a818eb75aae7a3',
    '2026-10-21T00:00:00Z', 'text/plain', 35, 'fixture-parser/1',
    'art_foundation_sample_v1', 1, '{"fixture":"foundation-v1"}',
    '2026-10-21T00:00:00Z'
);

INSERT INTO source_passages (
    id, schema_version, source_version_id, passage_order, locator_kind,
    locator_json, language, body, body_sha256, created_at
) VALUES (
    'psg_house_cost_fixture_p1', 1, 'srcv_house_cost_fixture_1', 0, 'page',
    '{"kind":"page","page":1}', 'en',
    'Illustrative fixture: a $500,000 purchase price is not the same as the lifetime cash outflow.',
    '94c2dacb4ada75e0f97129ffb12ffc68777be5c489c63be35d8504d7d761cb8b',
    '2026-10-21T00:00:00Z'
);

INSERT INTO packaging_hypothesis_sets (
    id, schema_version, project_ref, status, premise_setup, premise_payoff,
    hypothesis_count, document_json, document_sha256, created_at, approved_at
) VALUES (
    'pkg_house_cost_fixture_v1', 1, 'project_house_cost_fixture', 'approved',
    'What does a $500,000 house really cost over 30 years?',
    'Under the stated assumptions, the lifetime total is decomposed into financing, tax, insurance and maintenance.',
    3,
    '{"schemaVersion":1,"id":"pkg_house_cost_fixture_v1","projectRef":"project_house_cost_fixture","status":"approved","premiseSetup":{"question":"What does a $500,000 house really cost over 30 years?","audienceStakes":"Buyers can mistake the sticker price for the full cash outflow.","openingPromise":"The sticker price is only the beginning of the story.","evidenceRefs":["srcv_house_cost_fixture_1"]},"premisePayoff":{"answerEventId":"lifetime-total-reveal","payoffStatement":"Under the stated assumptions, the lifetime total is decomposed into financing, tax, insurance and maintenance.","limitation":"Illustrative assumptions only; not a universal market claim.","evidenceRefs":["srcv_house_cost_fixture_1"]},"hypotheses":[{"hypothesisId":"hyp_cost_reversal","title":"The Real 30-Year Cost of a $500,000 House","strategy":"visible-cost-reversal","thumbnailConcept":"Price tag beside a growing lifetime-cost meter","openingVisual":"House price appears, then cost layers stack","payoffEventId":"lifetime-total-reveal","claimRefs":["srcv_house_cost_fixture_1"]},{"hypothesisId":"hyp_mechanism_cutaway","title":"Where a $500,000 House Payment Actually Goes","strategy":"mechanism-cutaway","thumbnailConcept":"Cutaway of a house with four labeled cost layers","openingVisual":"Monthly payment splits into principal, interest, tax and upkeep","payoffEventId":"lifetime-total-reveal","claimRefs":["srcv_house_cost_fixture_1"]},{"hypothesisId":"hyp_decision_comparison","title":"Rent vs Buy: The 30-Year Cash Difference","strategy":"decision-comparison","thumbnailConcept":"Two columns, rent and buy, with a 30-year total","openingVisual":"Two households make the same income but different housing choices","payoffEventId":"lifetime-total-reveal","claimRefs":["srcv_house_cost_fixture_1"]}],"metrics":[{"metricKey":"purchase_price","provenance":"estimated","value":{"kind":"number","value":500000.0},"unit":"USD","method":"Illustrative fixture assumption, not market data"},{"metricKey":"mortgage_rate","provenance":"estimated","value":{"kind":"range","low":0.055,"high":0.075},"unit":"ratio","method":"Illustrative sensitivity range"},{"metricKey":"source_page_count","provenance":"measured","value":{"kind":"number","value":1.0},"unit":"pages","sourceVersionId":"srcv_house_cost_fixture_1","observedAt":"2026-10-21T00:00:00Z"},{"metricKey":"local_property_tax","provenance":"unknown","value":{"kind":"unknown"},"unit":"USD/year"}],"createdAt":"2026-10-21T00:00:00Z","approvedAt":"2026-10-21T00:05:00Z"}',
    '027b13b0b29bd45d26be3f7c7b084d0cacc59e8f7e89e7ab0aafb1c41e0628dd',
    '2026-10-21T00:00:00Z', '2026-10-21T00:05:00Z'
);

INSERT INTO packaging_metric_provenance (
    id, hypothesis_set_id, metric_key, provenance, value_type, numeric_value,
    range_low, range_high, text_value, boolean_value, unit, source_version_id,
    observed_at, method
) VALUES
    ('pkgmetric_purchase_price', 'pkg_house_cost_fixture_v1', 'purchase_price',
     'estimated', 'number', 500000.0, NULL, NULL, NULL, NULL, 'USD', NULL, NULL,
     'Illustrative fixture assumption, not market data'),
    ('pkgmetric_mortgage_rate', 'pkg_house_cost_fixture_v1', 'mortgage_rate',
     'estimated', 'range', NULL, 0.055, 0.075, NULL, NULL, 'ratio', NULL, NULL,
     'Illustrative sensitivity range'),
    ('pkgmetric_source_page_count', 'pkg_house_cost_fixture_v1', 'source_page_count',
     'measured', 'number', 1.0, NULL, NULL, NULL, NULL, 'pages',
     'srcv_house_cost_fixture_1', '2026-10-21T00:00:00Z', NULL),
    ('pkgmetric_local_property_tax', 'pkg_house_cost_fixture_v1', 'local_property_tax',
     'unknown', 'null', NULL, NULL, NULL, NULL, NULL, 'USD/year', NULL, NULL, NULL);

INSERT INTO jobs (
    id, schema_version, job_kind, state, idempotency_key, created_at, updated_at
) VALUES (
    'job_foundation_fixture_v1', 1, 'foundation-fixture', 'RUNNING',
    'job-foundation-fixture-v1', '2026-10-21T00:00:00Z', '2026-10-21T00:01:01Z'
);

INSERT INTO job_nodes (
    id, schema_version, job_id, node_key, node_kind, state, attempt_count,
    max_attempts, idempotency_key, input_json, output_json, error_code,
    created_at, updated_at
) VALUES
    ('node_research_fixture', 1, 'job_foundation_fixture_v1', 'research-evidence',
     'research', 'SUCCEEDED', 1, 3, 'node-research-fixture-v1', '{}',
     '{"sourceVersionId":"srcv_house_cost_fixture_1"}', NULL,
     '2026-10-21T00:00:00Z', '2026-10-21T00:01:00Z'),
    ('node_packaging_fixture', 1, 'job_foundation_fixture_v1', 'creative-packaging',
     'creative', 'RUNNING', 1, 3, 'node-packaging-fixture-v1', '{}', NULL, NULL,
     '2026-10-21T00:00:00Z', '2026-10-21T00:01:01Z'),
    ('node_render_fixture', 1, 'job_foundation_fixture_v1', 'jobs-render',
     'jobs', 'PENDING', 0, 2, 'node-render-fixture-v1', '{}', NULL, NULL,
     '2026-10-21T00:00:00Z', '2026-10-21T00:00:00Z');

INSERT INTO job_edges (job_id, from_node_id, to_node_id, edge_kind, created_at) VALUES
    ('job_foundation_fixture_v1', 'node_research_fixture', 'node_packaging_fixture',
     'dependency', '2026-10-21T00:00:00Z'),
    ('job_foundation_fixture_v1', 'node_packaging_fixture', 'node_render_fixture',
     'dependency', '2026-10-21T00:00:00Z');

INSERT INTO job_attempts (
    id, node_id, attempt_number, idempotency_key, state, started_at, finished_at,
    error_code, error_detail, metadata_json, created_at
) VALUES
    ('attempt_research_fixture_1', 'node_research_fixture', 1,
     'attempt-research-fixture-1', 'SUCCEEDED', '2026-10-21T00:00:01Z',
     '2026-10-21T00:01:00Z', NULL, NULL, '{}', '2026-10-21T00:00:01Z'),
    ('attempt_packaging_fixture_1', 'node_packaging_fixture', 1,
     'attempt-packaging-fixture-1', 'RUNNING', '2026-10-21T00:01:01Z',
     NULL, NULL, NULL, '{}', '2026-10-21T00:01:01Z');
