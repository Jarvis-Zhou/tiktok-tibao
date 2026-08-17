export const VIDEO_MIGRATION_001 = {
  version: 1,
  name: "phase-a-foundation",
  sql: `
    CREATE TABLE video_projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      catalog_shop_id TEXT,
      catalog_product_id TEXT,
      catalog_snapshot_json TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      current_step TEXT NOT NULL,
      target_market TEXT NOT NULL,
      language TEXT NOT NULL,
      target_duration_sec INTEGER,
      similarity_score INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      generation INTEGER NOT NULL DEFAULT 0,
      active_source_blueprint_id TEXT,
      active_product_profile_id TEXT,
      active_adapted_blueprint_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX idx_video_projects_owner_updated
      ON video_projects(owner_id, updated_at DESC, id);
    CREATE INDEX idx_video_projects_owner_status_updated
      ON video_projects(owner_id, status, updated_at DESC);

    CREATE TABLE video_assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      storage_key TEXT,
      sha256 TEXT,
      mime_type TEXT NOT NULL,
      bytes INTEGER,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(bytes IS NULL OR bytes >= 0)
    );

    CREATE TABLE video_project_assets (
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES video_assets(id),
      role TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY(project_id, asset_id, role)
    );

    CREATE INDEX idx_video_project_assets_role
      ON video_project_assets(project_id, role, sort_order);

    CREATE TABLE video_upload_sessions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES video_assets(id),
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      expected_mime TEXT NOT NULL,
      expected_bytes INTEGER,
      expected_sha256 TEXT,
      received_bytes INTEGER,
      received_sha256 TEXT,
      temp_key TEXT NOT NULL,
      max_bytes INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_video_upload_sessions_expiry
      ON video_upload_sessions(status, expires_at);

    CREATE TABLE video_blueprints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      schema_version TEXT NOT NULL,
      data_json TEXT NOT NULL,
      status TEXT NOT NULL,
      parent_blueprint_id TEXT,
      product_profile_id TEXT,
      input_fingerprint TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, kind, version)
    );

    CREATE TABLE video_product_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      schema_version TEXT NOT NULL,
      data_json TEXT NOT NULL,
      status TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, version)
    );

    CREATE TABLE video_storyboard_scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      adapted_blueprint_id TEXT NOT NULL REFERENCES video_blueprints(id),
      position INTEGER NOT NULL,
      generation_status TEXT NOT NULL,
      current_revision_id TEXT,
      locked_revision_id TEXT,
      generation INTEGER NOT NULL DEFAULT 1,
      stale_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, position)
    );

    CREATE TABLE video_scene_revisions (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL REFERENCES video_storyboard_scenes(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      schema_version TEXT NOT NULL,
      data_json TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      qc_status TEXT NOT NULL,
      source_job_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(scene_id, revision)
    );

    CREATE TABLE video_idempotency_records (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      UNIQUE(owner_id, scope, key)
    );

    CREATE INDEX idx_video_idempotency_expiry ON video_idempotency_records(expires_at);

    CREATE TABLE video_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      input_revision_map_json TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      target_generation INTEGER NOT NULL,
      idempotency_record_id TEXT UNIQUE,
      retry_of_job_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_run_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      heartbeat_at TEXT,
      provider_request_id TEXT,
      progress_stage TEXT,
      error_code TEXT,
      error_message TEXT,
      error_retryable INTEGER,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_video_jobs_claim
      ON video_jobs(status, next_run_at, priority DESC, created_at);
    CREATE INDEX idx_video_jobs_project_status
      ON video_jobs(project_id, status, created_at DESC);
    CREATE INDEX idx_video_jobs_lease ON video_jobs(lease_expires_at);

    CREATE TABLE video_job_steps (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      input_fingerprint TEXT NOT NULL,
      output_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_id, name)
    );

    CREATE TABLE video_usage_budgets (
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      max_units INTEGER NOT NULL,
      spent_units INTEGER NOT NULL DEFAULT 0,
      reserved_units INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_id, project_id)
    );

    CREATE TABLE video_usage_reservations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
      units INTEGER NOT NULL,
      actual_units INTEGER,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_id)
    );

    CREATE TABLE video_rights_acceptances (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      policy_version TEXT NOT NULL,
      request_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE video_provider_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_request_id TEXT,
      duration_ms INTEGER,
      input_hash TEXT NOT NULL,
      output_hash TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE video_asset_references (
      asset_id TEXT NOT NULL REFERENCES video_assets(id),
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(asset_id, ref_type, ref_id)
    );

    CREATE TABLE video_event_cursor (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      last_event_id INTEGER NOT NULL
    );
    INSERT INTO video_event_cursor(singleton, last_event_id) VALUES (1, 0);

    CREATE TABLE video_project_events (
      event_id INTEGER PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_video_project_events_project
      ON video_project_events(project_id, event_id);
  `,
} as const;
