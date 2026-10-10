import { describe } from 'vitest';
import { billingContract } from './sandbox-billing-contract.js';
import { MemorySandboxStore } from './sandbox-test-support.js';
describe('sandbox billing', () => billingContract(() => new MemorySandboxStore()));
