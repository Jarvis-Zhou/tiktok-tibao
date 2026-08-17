import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { VideoDomainError } from "@tibao/video-core";

export interface MediaProbe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  hasAudio: boolean;
  audioCodec: string | null;
}

export interface ImageProbe {
  width: number;
  height: number;
  codec: string;
}

export interface PreparedSourceMedia {
  probe: MediaProbe;
  framePaths: string[];
  contactSheetPath: string | null;
  audioPath: string | null;
  cleanup(): Promise<void>;
}

export interface MediaToolchain {
  probeVideo(path: string, signal?: AbortSignal): Promise<MediaProbe>;
  probeImage(path: string, signal?: AbortSignal): Promise<ImageProbe>;
  prepareSource(path: string, workspaceId: string, probe: MediaProbe, signal: AbortSignal): Promise<PreparedSourceMedia>;
}

export interface FfmpegMediaToolchainOptions {
  ffmpegPath: string;
  ffprobePath: string;
  tempRoot: string;
  timeoutMs: number;
  maxDecodedPixels: number;
  maxExtractedFrames: number;
}

interface ProbePayload {
  streams?: Array<Record<string, unknown>>;
  format?: Record<string, unknown>;
}

function ratio(value: unknown): number {
  if (typeof value !== "string") return 0;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator! / denominator!;
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function parseVideoProbe(value: unknown): MediaProbe {
  const payload = value as ProbePayload;
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationSec = positiveNumber(payload?.format?.duration);
  const width = positiveNumber(video?.width);
  const height = positiveNumber(video?.height);
  if (!video || durationSec <= 0 || width <= 0 || height <= 0) {
    throw new VideoDomainError({ code: "SOURCE_FILE_INVALID", message: "Video metadata could not be decoded", statusCode: 422 });
  }
  return {
    durationSec,
    width,
    height,
    fps: ratio(video.r_frame_rate),
    videoCodec: typeof video.codec_name === "string" ? video.codec_name : "other",
    hasAudio: Boolean(audio),
    audioCodec: audio && typeof audio.codec_name === "string" ? audio.codec_name : null,
  };
}

export function parseImageProbe(value: unknown): ImageProbe {
  const payload = value as ProbePayload;
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const image = streams.find((stream) => stream.codec_type === "video");
  const width = positiveNumber(image?.width);
  const height = positiveNumber(image?.height);
  if (!image || width <= 0 || height <= 0) {
    throw new VideoDomainError({ code: "UPLOAD_CONTENT_INVALID", message: "Image pixels could not be decoded", statusCode: 422 });
  }
  return { width, height, codec: typeof image.codec_name === "string" ? image.codec_name : "other" };
}

export class FfmpegMediaToolchain implements MediaToolchain {
  constructor(private readonly options: FfmpegMediaToolchainOptions) {}

  async probeVideo(path: string, signal?: AbortSignal): Promise<MediaProbe> {
    const payload = await this.ffprobe(path, signal);
    const probe = parseVideoProbe(payload);
    if (probe.durationSec < 3 || probe.durationSec > 30) {
      throw new VideoDomainError({ code: "SOURCE_FILE_INVALID", message: "Reference video duration must be between 3 and 30 seconds", statusCode: 422 });
    }
    this.assertPixels(probe.width, probe.height, "Reference video");
    return probe;
  }

  async probeImage(path: string, signal?: AbortSignal): Promise<ImageProbe> {
    const probe = parseImageProbe(await this.ffprobe(path, signal));
    this.assertPixels(probe.width, probe.height, "Product image");
    return probe;
  }

  async prepareSource(
    path: string,
    workspaceId: string,
    probe: MediaProbe,
    signal: AbortSignal,
  ): Promise<PreparedSourceMedia> {
    if (!/^[0-9a-z-]{1,128}$/i.test(workspaceId)) throw new Error("Unsafe media workspace id");
    const workspace = join(this.options.tempRoot, `media-${workspaceId}`);
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    const framePattern = join(workspace, "frame-%03d.jpg");
    const frameRate = Math.max(0.1, this.options.maxExtractedFrames / probe.durationSec);
    await this.run(this.options.ffmpegPath, [
      "-nostdin", "-v", "error", "-i", path,
      "-vf", `fps=${frameRate.toFixed(4)},scale='min(720,iw)':-2`,
      "-frames:v", String(this.options.maxExtractedFrames), "-q:v", "3", "-y", framePattern,
    ], signal);
    const framePaths = (await readdir(workspace))
      .filter((file) => /^frame-\d+\.jpg$/.test(file))
      .sort()
      .map((file) => join(workspace, file));
    const contactSheetPath = join(workspace, "contact-sheet.jpg");
    let contactSheet: string | null = null;
    try {
      const contactRate = Math.max(0.1, Math.min(12, this.options.maxExtractedFrames) / probe.durationSec);
      await this.run(this.options.ffmpegPath, [
        "-nostdin", "-v", "error", "-i", path,
        "-vf", `fps=${contactRate.toFixed(4)},scale=240:-2,tile=4x3`,
        "-frames:v", "1", "-q:v", "3", "-y", contactSheetPath,
      ], signal);
      contactSheet = contactSheetPath;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    let audioPath: string | null = null;
    if (probe.hasAudio) {
      const candidate = join(workspace, "audio.wav");
      try {
        await this.run(this.options.ffmpegPath, [
          "-nostdin", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-y", candidate,
        ], signal);
        audioPath = candidate;
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    return {
      probe,
      framePaths,
      contactSheetPath: contactSheet,
      audioPath,
      cleanup: async () => rm(workspace, { recursive: true, force: true }),
    };
  }

  private async ffprobe(path: string, signal?: AbortSignal): Promise<unknown> {
    const output = await this.run(this.options.ffprobePath, [
      "-v", "error", "-show_entries",
      "format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate",
      "-of", "json", path,
    ], signal);
    try {
      return JSON.parse(output);
    } catch {
      throw new VideoDomainError({ code: "SOURCE_FILE_INVALID", message: "Media probe returned invalid metadata", statusCode: 422 });
    }
  }

  private assertPixels(width: number, height: number, label: string): void {
    if (width * height > this.options.maxDecodedPixels) {
      throw new VideoDomainError({ code: "UPLOAD_CONTENT_INVALID", message: `${label} exceeds the decoded pixel limit`, statusCode: 422 });
    }
  }

  private run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const error = new Error("Media process aborted");
        error.name = "AbortError";
        reject(error);
        return;
      }
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      }, this.options.timeoutMs);
      const abort = () => {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      };
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.reduce((sum, item) => sum + item.length, 0) < 2 * 1024 * 1024) stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.reduce((sum, item) => sum + item.length, 0) < 64 * 1024) stderr.push(chunk);
      });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
        reject(new VideoDomainError({ code: "MEDIA_TOOL_UNAVAILABLE", message: `Media tool could not start: ${error.message}`, statusCode: 503, retryable: true }));
      });
      child.once("close", (code, childSignal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) {
          const error = new Error("Media process aborted");
          error.name = "AbortError";
          reject(error);
          return;
        }
        if (code !== 0) {
          reject(new VideoDomainError({
            code: "MEDIA_PROCESS_FAILED",
            message: "Media processing failed while decoding the uploaded file",
            statusCode: 422,
          }));
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8"));
      });
    });
  }
}
