import { formatOpenAiEnvironment } from './sidecar-config.js';

export interface CliCommandDependencies {
  loopbackBaseUrl: string;
  readToken(): Promise<string>;
  importMnemonic(mnemonic: string): Promise<void>;
  readMnemonic(): Promise<string>;
  write(line: string): void;
}

/** Handles the non-server CLI commands independently from terminal I/O. */
export async function runCliCommand(
  args: readonly string[],
  dependencies: CliCommandDependencies,
): Promise<void> {
  switch (args[0]) {
    case 'env': {
      dependencies.write(formatOpenAiEnvironment(
        dependencies.loopbackBaseUrl,
        await dependencies.readToken(),
      ));
      return;
    }
    case 'import-mnemonic': {
      await dependencies.importMnemonic(await dependencies.readMnemonic());
      dependencies.write('ZK Credits identity imported into the system credential store.');
      return;
    }
    default:
      throw new Error('Usage: zk-credits <import-mnemonic|serve|env>');
  }
}
