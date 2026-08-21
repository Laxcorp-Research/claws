-- Per-model adjustable-reasoning capability for the model picker.
-- Nullable, no backfill: null means "unknown" and the UI keeps the thinking
-- control enabled (the runtime safely ignores thinking levels on models
-- without reasoning). The daily catalog refresh fills real values from
-- OpenRouter supported_parameters and the Anthropic version heuristic.
ALTER TABLE "ModelCatalogEntry" ADD COLUMN "supportsReasoning" BOOLEAN;
