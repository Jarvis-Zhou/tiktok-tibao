import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TibaoDatabase } from "../src/database.js";
import { ProjectEventDispatcher } from "../src/video/events/project-event-dispatcher.js";
import { SqliteVideoRepository, type VideoProjectEvent } from "../src/video/repository/sqlite-video-repository.js";

test("one dispatcher replays committed events and relays later project changes in order", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tibao-video-events-"));
  const database = new TibaoDatabase(join(directory, "queue.sqlite"));
  let dispatcher: ProjectEventDispatcher | undefined;
  const repository = new SqliteVideoRepository(database, 10, () => dispatcher?.notify());
  dispatcher = new ProjectEventDispatcher(repository, 5, 20);
  try {
    const project = repository.createProject({
      ownerId: "local",
      name: "Events",
      catalogContext: null,
      targetMarket: "MY",
      language: "ms-MY",
      targetDurationSec: null,
      similarityScore: 60,
      idempotency: { key: "create", scope: "create", requestHash: "create" },
    }).project;
    const received: VideoProjectEvent[] = [];
    const unsubscribe = dispatcher.subscribe(project.id, 0, (event) => received.push(event));
    repository.updateProject(
      "local",
      project.id,
      1,
      { name: "Events updated" },
      { key: "update", scope: "update", requestHash: "update" },
    );
    for (let attempt = 0; attempt < 50 && received.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    unsubscribe();
    assert.deepEqual(received.map((event) => event.type), ["project.created", "project.updated"]);
    assert.deepEqual(received.map((event) => event.id), [1, 2]);
  } finally {
    dispatcher.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
