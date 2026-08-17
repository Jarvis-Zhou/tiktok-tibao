import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FfmpegMediaToolchain, parseVideoProbe } from "../src/video/media/ffmpeg-media-toolchain.js";

test("ffprobe JSON is normalized without trusting upload metadata", () => {
  const probe = parseVideoProbe({
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, r_frame_rate: "30000/1001" },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: "15.25" },
  });
  assert.equal(probe.durationSec, 15.25);
  assert.equal(probe.width, 1080);
  assert.equal(probe.height, 1920);
  assert.equal(probe.hasAudio, true);
  assert.ok(probe.fps > 29 && probe.fps < 30);
});
test("real FFmpeg pipeline probes, extracts frames, and skips audio for a silent video", async (t) => {
  const available = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (available.status !== 0) {
    t.skip("ffmpeg is unavailable on this machine");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "tibao-media-tools-"));
  const source = join(directory, "source.mp4");
  try {
    const generated = spawnSync("ffmpeg", [
      "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x284:rate=10",
      "-t", "3", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", source,
    ], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const tools = new FfmpegMediaToolchain({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      tempRoot: directory,
      timeoutMs: 30_000,
      maxDecodedPixels: 4_000_000,
      maxExtractedFrames: 6,
    });
    const probe = await tools.probeVideo(source);
    assert.equal(probe.durationSec, 3);
    assert.equal(probe.hasAudio, false);
    const prepared = await tools.prepareSource(source, "fixture", probe, new AbortController().signal);
    assert.ok(prepared.framePaths.length >= 3);
    assert.equal(prepared.audioPath, null);
    await prepared.cleanup();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
