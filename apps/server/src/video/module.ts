import {
  FakeStoryboardImageProvider,
  FakeVideoProvider,
  OpenAiCompatibleAnalysisProvider,
  OpenAiCompatibleStoryboardProvider,
  ProviderRegistry,
  providerTraceId,
  validateStructuredOutput,
} from "@tibao/ai-providers";
import { assertPrototypeAnalysisResult } from "@tibao/video-core";
import { VideoWorkerRuntime, type WorkerHandler } from "@tibao/video-worker";
import type { AppConfig, VideoConfig } from "../config.js";
import { resolveVideoConfig } from "../config.js";
import type { TibaoDatabase } from "../database.js";
import { ProjectEventDispatcher } from "./events/project-event-dispatcher.js";
import { buildPromptPackage } from "./export/prompt-package.js";
import { FfmpegMediaToolchain, type MediaToolchain } from "./media/ffmpeg-media-toolchain.js";
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
  readonly media: MediaToolchain;
  readonly worker: VideoWorkerRuntime;

  private constructor(input: {
    config: VideoConfig;
    repository: SqliteVideoRepository;
    storage: LocalVideoAssetStore;
    events: ProjectEventDispatcher;
    media: MediaToolchain;
    worker: VideoWorkerRuntime;
  }) {
    this.config = input.config;
    this.repository = input.repository;
    this.storage = input.storage;
    this.events = input.events;
    this.media = input.media;
    this.worker = input.worker;
  }

  static async create(
    appConfig: AppConfig,
    database: TibaoDatabase,
    logger: VideoModuleLogger,
    mediaToolchain?: MediaToolchain,
  ): Promise<VideoModule> {
    const config = resolveVideoConfig(appConfig);
    const storage = new LocalVideoAssetStore(
      config.storageRoot,
      config.tempRoot,
      config.dataEncryptionKey,
    );
    await storage.initialize();
    const media = mediaToolchain ?? new FfmpegMediaToolchain({
      ffmpegPath: config.ffmpegPath,
      ffprobePath: config.ffprobePath,
      tempRoot: config.tempRoot,
      timeoutMs: config.mediaProcessTimeoutMs,
      maxDecodedPixels: config.maxDecodedPixels,
      maxExtractedFrames: config.maxExtractedFrames,
    });
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
    const providerOptions = {
      baseUrl: config.providerBaseUrl,
      apiKey: config.providerApiKey,
      analysisModel: config.analysisModel,
      ...(config.storyboardModel ? { imageModel: config.storyboardModel } : {}),
      analysisApi: config.analysisApi,
      reasoningEffort: config.analysisReasoningEffort,
      ...(config.transcriptionProvider === "disabled"
        ? {}
        : {
            transcriptionModel: config.transcriptionModel,
            transcriptionBaseUrl: config.transcriptionBaseUrl,
            transcriptionApiKey: config.transcriptionApiKey,
            transcriptionProvider: config.transcriptionProvider,
            transcriptionRequestTimeoutMs: config.transcriptionRequestTimeoutMs,
          }),
      requestTimeoutMs: config.providerRequestTimeoutMs,
      maxFrames: config.providerMaxFrames,
    } as const;
    const providers = new ProviderRegistry(
      config.provider === "fake"
        ? new FakeVideoProvider()
        : new OpenAiCompatibleAnalysisProvider(providerOptions),
      config.storyboardProvider === "fake"
        ? new FakeStoryboardImageProvider()
        : new OpenAiCompatibleStoryboardProvider(providerOptions),
    );
    const prototypeHandler: WorkerHandler = async (job, context) => {
      await context.progress("media_probe");
      const providerInput = repository.prototypeAnalysisInput(job);
      const sourcePath = storage.storagePath(providerInput.sourceStorageKey);
      const probe = await media.probeVideo(sourcePath, context.signal);
      await context.progress("frame_extraction");
      const prepared = await media.prepareSource(sourcePath, job.id, probe, context.signal);
      try {
        await context.progress(
          prepared.audioPath
            ? config.transcriptionProvider !== "disabled"
              ? "transcription_and_visual_analysis"
              : "asr_unconfigured"
            : "asr_skipped_no_audio",
        );
        await context.progress("visual_analysis");
        const {
          sourceStorageKey: _sourceStorageKey,
          productStorageKeys,
          ...safeProviderInput
        } = providerInput;
        const provider = providers.prototypeAnalysis();
        await context.markProviderSubmitted(providerTraceId(provider.id, job.id));
        const rawResult = await provider.analyze({
          ...safeProviderInput,
          sourceFramePaths: prepared.framePaths,
          sourceContactSheetPath: prepared.contactSheetPath,
          sourceAudioPath: prepared.audioPath,
          productImagePaths: productStorageKeys.map((storageKey) => storage.storagePath(storageKey)),
        }, context.signal);
        await context.progress("schema_validation");
        const validated = await validateStructuredOutput({
          value: rawResult.value,
          validate: assertPrototypeAnalysisResult,
          signal: context.signal,
        });
        return {
          kind: "prototype_analysis",
          result: validated.value,
          provider: rawResult.provider,
          model: rawResult.model,
          providerRequestId: rawResult.providerRequestId,
          usage: rawResult.usage,
          estimatedCostMicros: rawResult.estimatedCostMicros,
          latencyMs: rawResult.latencyMs,
          safety: {
            ...rawResult.safety,
            repair_attempts: validated.repairAttempts,
          },
        };
      } finally {
        await prepared.cleanup();
      }
    };
    const sceneStoryboardHandler: WorkerHandler = async (job, context) => {
      await context.progress("reading_scene_revision");
      const input = repository.sceneGenerationInput(job);
      const provider = providers.storyboardImage();
      await context.markProviderSubmitted(providerTraceId(provider.id, job.id));
      await context.progress("storyboard_image_generation");
      const generated = await provider.generate({
        projectId: input.projectId,
        sceneId: input.sceneId,
        generation: input.generation,
        imagePrompt: input.imagePrompt,
        negativePrompt: input.negativePrompt,
        productImagePaths: input.productStorageKeys.map((storageKey) => storage.storagePath(storageKey)),
        width: 180,
        height: 320,
      }, context.signal);
      await context.progress("storyboard_qc");
      const stored = await storage.putGenerated("local", generated.bytes);
      return {
        kind: "scene_storyboard",
        sceneId: input.sceneId,
        revisionId: input.revisionId,
        generation: input.generation,
        asset: {
          storageKey: stored.storageKey,
          sha256: stored.sha256,
          bytes: stored.bytes,
          mimeType: generated.mimeType,
          width: generated.width,
          height: generated.height,
          metadata: {},
        },
        qc: generated.qc,
        provider: provider.id,
        model: provider.model,
      };
    };
    const promptPackageHandler: WorkerHandler = async (job, context) => {
      await context.progress("snapshot_validation");
      const snapshot = repository.promptPackageInput(job);
      await context.progress("package_build");
      const built = await buildPromptPackage(snapshot, (storageKey) => storage.read(storageKey));
      const stored = await storage.putGenerated("local", built.zip);
      return {
        kind: "prompt_package_export",
        exportId: snapshot.export_id,
        asset: {
          storageKey: stored.storageKey,
          sha256: stored.sha256,
          bytes: stored.bytes,
          mimeType: "application/zip",
          width: null,
          height: null,
          metadata: {},
        },
        manifest: built.manifest,
      };
    };
    const worker = new VideoWorkerRuntime(
      repository,
      new Map([
        ["prototype_analysis", prototypeHandler],
        ["scene_storyboard", sceneStoryboardHandler],
        ["prompt_package_export", promptPackageHandler],
      ]),
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
    return new VideoModule({ config, repository, storage, events, media, worker });
  }

  async close(): Promise<void> {
    await this.worker.stop();
    this.events.close();
  }

  beginDrain(): void {
    this.worker.beginDrain();
  }
}
