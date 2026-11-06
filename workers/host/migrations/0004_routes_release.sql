-- Atomic keyless deploys (freegamestore-online/platform#488). The admin
-- worker's POST /v1/deploys/:id/commit sets `release` once every file of a
-- deploy is in R2; the host then serves `<r2_prefix>/.r/<release>/`. NULL keeps
-- serving `<r2_prefix>/` directly, where the legacy aws-sync workflows write.
ALTER TABLE routes ADD COLUMN release TEXT;
