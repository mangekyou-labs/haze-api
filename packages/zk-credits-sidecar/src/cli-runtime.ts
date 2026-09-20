import { formatOpenAiEnvironment } from './sidecar-config.js';

export interface CliCommandDependencies {
  loopbackBaseUrl: string;
  readToken(): Promise<string>;
  write(line: string): void;
  isCredentialConfigured(): Promise<boolean>;
  configureCodex(model?: string): Promise<void>;
  ensureSidecar(): Promise<string>;
  isCodexProfileInstalled(): Promise<boolean>;
  isSidecarHealthy(): Promise<boolean>;
  launchCodex(args: readonly string[]): Promise<number>;
  launchCline(args: readonly string[], localToken: string): Promise<number>;
}
function setupModel(args: readonly string[]): string | undefined {
  if (args[1] !== 'codex') throw new Error('Usage: zk-credits setup codex [--model <model>]');
  if (args.length === 2) return undefined;
  if (args.length === 4 && args[2] === '--model' && args[3]?.trim()) return args[3];
  throw new Error('Usage: zk-credits setup codex [--model <model>]');
}

/** Handles the non-server CLI commands independently from terminal I/O. */
export async function runCliCommand(
  args: readonly string[],
  dependencies: CliCommandDependencies,
): Promise<number> {
  switch (args[0]) {
    case 'env': {
      dependencies.write(formatOpenAiEnvironment(
        dependencies.loopbackBaseUrl,
        await dependencies.readToken(),
      ));
      return 0;
    }
    case 'setup': {
      const model = setupModel(args);
      if (!await dependencies.isCredentialConfigured()) throw new Error('Set ZK_CREDITS_CREDENTIAL_PATH before running zk-credits setup');
      await dependencies.configureCodex(model);
      await dependencies.ensureSidecar();
      dependencies.write('ZK Credits is ready for Codex.');
      dependencies.write('Run: zk-credits codex');
      return 0;
    }
    case 'token': {
      dependencies.write(await dependencies.ensureSidecar());
      return 0;
    }
    case 'status': {
      dependencies.write(`Credential export: ${await dependencies.isCredentialConfigured() ? 'configured' : 'missing'}`);
      dependencies.write(`Codex profile: ${await dependencies.isCodexProfileInstalled() ? 'installed' : 'missing'}`);
      dependencies.write(`Sidecar: ${await dependencies.isSidecarHealthy() ? 'running' : 'stopped'}`);
      return 0;
    }
    case 'codex': {
      if (!await dependencies.isCodexProfileInstalled()) {
        throw new Error('Run zk-credits setup codex first');
      }
      await dependencies.ensureSidecar();
      return dependencies.launchCodex(args.slice(1));
    }
    case 'cline': {
      if (!await dependencies.isCredentialConfigured()) throw new Error('Set ZK_CREDITS_CREDENTIAL_PATH before running zk-credits cline');
      const localToken = await dependencies.ensureSidecar();
      return dependencies.launchCline(args.slice(1), localToken);
    }
    default:
      throw new Error('Usage: zk-credits <cline|setup codex|codex|status|token|serve|env>');
  }
}
