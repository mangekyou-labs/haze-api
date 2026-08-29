// Fee-sponsor HTTP service (M2.4).
//
// Public POST /v1/fee-relay endpoint around the fee-relay core. Fee-only
// authority: it fee-bumps slash/withdraw inner txs with the sponsor key and
// never alters their contents. Idempotent on the inner tx hash.

import express, { Request, Response } from 'express';
import { relayOne, InvalidRelayRequestError, type FeeRelayDeps } from './fee-relay.js';

export function createFeeRelayApp(deps: FeeRelayDeps): ReturnType<typeof express> {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'fee-sponsor' });
  });

  app.post('/v1/fee-relay', async (req: Request, res: Response) => {
    try {
      const innerTxXdr = (req.body?.innerTransactionXdr ?? req.body?.innerTxXdr) as string | undefined;
      if (!innerTxXdr) {
        res.status(400).json({ error: 'missing_inner_transaction' });
        return;
      }
      const result = await relayOne(deps, innerTxXdr);
      res.json({
        accepted: true,
        duplicate: result.duplicate,
        method: result.method,
        innerTxHash: result.innerTxHash,
        feeBumpHash: result.feeBumpHash,
      });
    } catch (err: unknown) {
      if (err instanceof InvalidRelayRequestError) {
        res.status(err.status).json({ error: 'invalid_relay_request', message: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('/v1/fee-relay error:', message);
      res.status(500).json({ error: 'internal_error', message });
    }
  });

  return app;
}