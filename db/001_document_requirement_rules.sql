-- Conditional document requirements (PostgreSQL 15+).
--
-- One row per document type per level. entity_id IS NULL = company default
-- (Settings > Customs Declarations > Default Document Types). entity_id set =
-- that entity's override (Entity > Document checks).
--
-- NULL in a condition column means "All". Empty arrays are rejected so that
-- unticking every option in the UI can't silently mean "never" or "always".
-- Adapt table/foreign key names to the existing schema.

CREATE TABLE document_requirement_rule (
    id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id                   uuid NOT NULL,
    entity_id                    uuid NULL,
    document_type                text NOT NULL,
    action                       text NOT NULL DEFAULT 'REQUIRE'
                                     CHECK (action IN ('REQUIRE', 'EXCLUDE')),

    -- "Applies to" conditions
    modes                        text[] NULL
        CHECK (modes IS NULL OR (cardinality(modes) > 0
               AND modes <@ ARRAY['SEA','AIR','ROAD','RAIL','POST','COURIER'])),
    directions                   text[] NULL
        CHECK (directions IS NULL OR (cardinality(directions) > 0
               AND directions <@ ARRAY['IMPORT','EXPORT'])),
    load_types                   text[] NULL
        CHECK (load_types IS NULL OR (cardinality(load_types) > 0
               AND load_types <@ ARRAY['FCL','LCL','BREAK_BULK','LOOSE'])),
    origin_countries             char(2)[] NULL
        CHECK (origin_countries IS NULL OR cardinality(origin_countries) > 0),
    destination_countries        char(2)[] NULL
        CHECK (destination_countries IS NULL OR cardinality(destination_countries) > 0),
    only_when_preference_claimed boolean NOT NULL DEFAULT false,

    -- Other document types that satisfy this one (e.g. SEA_WAYBILL for BILL_OF_LADING)
    accepted_alternatives        text[] NOT NULL DEFAULT '{}',

    sort_order                   integer NOT NULL DEFAULT 0,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    updated_at                   timestamptz NOT NULL DEFAULT now(),
    updated_by                   uuid NULL,

    -- A company default can't be "excluded"; only entities exclude.
    CHECK (entity_id IS NOT NULL OR action = 'REQUIRE'),

    -- One rule per document per level. NULLS NOT DISTINCT makes the company
    -- level (entity_id NULL) unique too.
    UNIQUE NULLS NOT DISTINCT (company_id, entity_id, document_type)
);

CREATE INDEX document_requirement_rule_lookup
    ON document_requirement_rule (company_id, entity_id);

-- Shipment fields the engine reads. Skip any that already exist under
-- another name and map them in the loader instead.
-- ALTER TABLE shipment ADD COLUMN transport_mode text NULL;      -- SEA/AIR/...
-- ALTER TABLE shipment ADD COLUMN direction text NULL;           -- IMPORT/EXPORT
-- ALTER TABLE shipment ADD COLUMN load_type text NULL;           -- FCL/LCL/...
-- ALTER TABLE shipment ADD COLUMN preference_claimed boolean NULL;

-- Backfill: copy existing flat lists with no conditions, so behaviour is
-- unchanged until someone edits "Applies to". Example, adapt to real tables:
-- INSERT INTO document_requirement_rule (company_id, entity_id, document_type, sort_order)
-- SELECT company_id, NULL, document_type, position FROM company_default_document_type;
-- INSERT INTO document_requirement_rule (company_id, entity_id, document_type, sort_order)
-- SELECT company_id, entity_id, document_type, position FROM entity_document_type;
