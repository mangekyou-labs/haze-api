export interface SidecarLifecycleDependencies {
  isHealthy(): Promise<boolean>;
  startDetached(): Promise<void>;
  readToken(): Promise<string>;
  wait(milliseconds: number): Promise<void>;
  logPath: string;
}

export interface SidecarReadinessOptions {
  attempts?: number;
  intervalMs?: number;
}

/** Ensures one loopback sidecar is ready before exposing its local bearer. */
export async function ensureSidecarReady(
  dependencies: SidecarLifecycleDependencies,
  options: SidecarReadinessOptions = {},
): Promise<string> {
  if (await dependencies.isHealthy()) return dependencies.readToken();

  await dependencies.startDetached();
  const attempts = options.attempts ?? 50;
  const intervalMs = options.intervalMs ?? 100;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await dependencies.wait(intervalMs);
    if (await dependencies.isHealthy()) return dependencies.readToken();
  }

  throw new Error(`ZK Credits sidecar did not become ready; inspect ${dependencies.logPath}`);
}
