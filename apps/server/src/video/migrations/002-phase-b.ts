export const VIDEO_MIGRATION_002 = {
  version: 2,
  name: "phase-b-scenes-and-exports",
  sql: `
    ALTER TABLE video_scene_revisions ADD COLUMN updated_at TEXT;
    UPDATE video_scene_revisions SET updated_at = created_at WHERE updated_at IS NULL;

    ALTER TABLE video_provider_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'succeeded';
    ALTER TABLE video_provider_runs ADD COLUMN usage_json TEXT;
    ALTER TABLE video_provider_runs ADD COLUMN estimated_cost_micros INTEGER;
    ALTER TABLE video_provider_runs ADD COLUMN latency_ms INTEGER;
    ALTER TABLE video_provider_runs ADD COLUMN safety_json TEXT;

    CREATE TABLE video_qc_acceptances (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      scene_id TEXT NOT NULL REFERENCES video_storyboard_scenes(id) ON DELETE CASCADE,
      scene_revision_id TEXT NOT NULL REFERENCES video_scene_revisions(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      request_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(owner_id, scene_revision_id)
    );

    CREATE TABLE video_exports (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      manifest_json TEXT,
      asset_id TEXT REFERENCES video_assets(id),
      job_id TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      ready_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_video_exports_project_created
      ON video_exports(project_id, created_at DESC);
  `,
} as const;
