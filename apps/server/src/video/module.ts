import { FakeVideoProvider, ProviderRegistry } from "@tibao/ai-providers";
import { VideoWorkerRuntime, type WorkerHandler } from "@tibao/video-worker";
import type { AppConfig, VideoConfig } from "../config.js";
import { resolveVideoConfig } from "../config.js";
import type { TibaoDatabase } from "../database.js";
import { ProjectEventDispatcher } from "./events/project-event-dispatcher.js";
import { SqliteVideoRepository } from "./repository/sqlite-video-repository.js";
import { LocalVideoAssetStore } from "./storage/local-asset-store.js";

export interface VideoModuleLogger {
  error(bindings: unknown, message?: string): void;
}

export class VideoModule {
  readonly config: VideoConfig;
  readonly repository: SqliteVideoRepository;
  readonly storage: LocalVideoAssetStore;
  readonly events: ProjectEventDispatcher;
  readonly worker: VideoWorkerRuntime;

  private constructor(input: {
    config: VideoConfig;
    repository: SqliteVideoRepository;
    storage: LocalVideoAssetStore;
    events: ProjectEventDispatcher;
    worker: VideoWorkerRuntime;
  }) {
    this.config = input.config;
    this.repository = input.repository;
    this.storage = input.storage;
    this.events = input.events;
    this.worker = input.worker;
  }

  static async create(
    appConfig: AppConfig,
    database: TibaoDatabase,
    logger: VideoModuleLogger,
  ): Promise<VideoModule> {
    const config = resolveVideoConfig(appConfig);
    const storage = new LocalVideoAssetStore(
      config.storageRoot,
      config.tempRoot,
      config.dataEncryptionKey,
    );
    await storage.initialize();
    let events: ProjectEventDispatcher | undefined;
    const repository = new SqliteVideoRepository(
      database,
      config.projectBudgetUnits,
      () => events?.notify(),
    );
    events = new ProjectEventDispatcher(
      repository,
      config.eventPollActiveMs,
      config.eventPollIdleMs,
      (error) => logger.error({ err: error }, "video event dispatcher failed"),
    );
    if (!config.fakeProvider) {
      throw new Error("Phase A requires VIDEO_FAKE_PROVIDER=true until a real provider is configured");
    }
    const providers = new ProviderRegistry(new FakeVideoProvider());
    const prototypeHandler: WorkerHandler = async (job, context) => {
      await context.progress("reading_inputs");
      const providerInput = repository.prototypeAnalysisInput(job);
      await context.progress("fake_provider");
      const result = await providers.prototypeAnalysis().analyze(providerInput, context.signal);
      await context.progress("validating_output");
      return result;
    };
    const worker = new VideoWorkerRuntime(
      repository,
      new Map([["prototype_analysis", prototypeHandler]]),
      {
        pollMs: config.jobPollMs,
        leaseMs: config.jobLeaseMs,
        heartbeatMs: config.jobHeartbeatMs,
        shutdownGraceMs: config.workerShutdownGraceMs,
        concurrency: {
          media: config.mediaConcurrency,
          text: config.textConcurrency,
          image: config.imageConcurrency,
        },
        onError: (error) => logger.error({ err: error }, "embedded video worker failed"),
      },
    );
    worker.start();
    return new VideoModule({ config, repository, storage, events, worker });
  }

  async close(): Promise<void> {
    await this.worker.stop();
    this.events.close();
  }

  beginDrain(): void {
    this.worker.beginDrain();
  }
}
