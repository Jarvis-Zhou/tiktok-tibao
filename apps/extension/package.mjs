import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";

const root = resolve(import.meta.dirname);
const buildDirectory = resolve(root, "build");
const artifactDirectory = resolve(root, "dist");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(buildDirectory, "manifest.json"), "utf8"));

if (manifest.manifest_version !== 3) {
  throw new Error("仅支持打包 Chrome Manifest V3 插件");
}
if (manifest.version !== packageJson.version) {
  throw new Error(
    `插件版本不一致：package.json=${packageJson.version}，manifest.json=${manifest.version}`,
  );
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`构建目录包含不支持的文件类型：${path}`);
  }
  return files;
}

const files = await listFiles(buildDirectory);
if (files.length === 0) throw new Error("插件构建目录为空，请先执行构建");

await mkdir(artifactDirectory, { recursive: true });
const archiveName = `tibao-extension-${packageJson.version}.zip`;
const archivePath = resolve(artifactDirectory, archiveName);
await rm(archivePath, { force: true });

const zip = new yazl.ZipFile();
const archiveDone = pipeline(zip.outputStream, createWriteStream(archivePath));
const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");

for (const file of files) {
  const archiveEntry = relative(buildDirectory, file).split(sep).join("/");
  zip.addFile(file, archiveEntry, {
    mtime: fixedTimestamp,
    mode: 0o100644,
    compressionLevel: 9,
    forceDosTimestamp: true,
  });
}

zip.end();
await archiveDone;

const archiveStats = await stat(archivePath);
const checksum = createHash("sha256").update(await readFile(archivePath)).digest("hex");
console.log(`Created ${basename(archivePath)} (${archiveStats.size} bytes)`);
console.log(`Output: ${archivePath}`);
console.log(`SHA-256: ${checksum}`);
