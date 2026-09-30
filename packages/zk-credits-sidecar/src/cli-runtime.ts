import { formatOpenAiEnvironment } from './sidecar-config.js';

export interface CliCommandDependencies {
  loopbackBaseUrl: string;
  readToken(): Promise<string>;
  write(line: string): void;
  isCredentialConfigured(): Promise<boolean>;
  validateSetupPrerequisites(): Promise<void>;
  configureCodex(model?: string): Promise<void>;
  ensureSidecar(): Promise<string>;
  isCodexProfileInstalled(): Promise<boolean>;
  isSidecarHealthy(): Promise<boolean>;
  launchCodex(args: readonly string[]): Promise<number>;
  launchCline(args: readonly string[], localToken: string): Promise<number>;
}
function setupModel(args: readonly string[]): string | undefined {
  const options = args.slice(1).filter((arg) => arg !== '--legacy');
  if (options[0] === 'codex' || options[0] === 'x402') options.shift();
  if (options.length === 0) return undefined;
  if (options.length === 2 && options[0] === '--model' && options[1]?.trim()) return options[1];
  throw new Error('Usage: zk-credits setup [codex|x402] [--legacy] [--model <model>]');
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
      await dependencies.validateSetupPrerequisites();
      if (args[1] === 'x402') {
        dependencies.write('ZK Credits is ready. Run: zk-credits x402-agent');
        return 0;
      }
      await dependencies.ensureSidecar();
      await dependencies.configureCodex(model);
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
