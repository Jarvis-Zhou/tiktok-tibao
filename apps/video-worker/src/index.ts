import { config as loadDotEnv } from "dotenv";
import { pathToFileURL } from "node:url";

export function assertStandaloneWorkerSupported(driver: string): void {
  if (driver.trim().toLowerCase() !== "postgresql") {
    throw new Error(
      "Standalone video-worker refuses SQLite: use VIDEO_WORKER_MODE=embedded in apps/server",
    );
  }
}

export function main(env: NodeJS.ProcessEnv = process.env): never {
  assertStandaloneWorkerSupported(env.VIDEO_DATABASE_DRIVER || "sqlite");
  throw new Error("PostgreSQL standalone worker wiring is scheduled for Phase C");
}

const isEntryPoint = Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1] as string).href;
if (isEntryPoint) {
  loadDotEnv();
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
