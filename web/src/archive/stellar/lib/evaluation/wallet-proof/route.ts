import { NextRequest } from 'next/server';
import { proxyEvaluationRequest } from '@/lib/evaluation-api';
import { invalidEvaluationFields, isRecord, pickFields } from '../evaluation-route';

const WALLET_PROOF_FIELDS = ['challengeId', 'address', 'signature', 'network', 'message'] as const;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidEvaluationFields();
  }
  if (!isRecord(body)
    || typeof body.challengeId !== 'string'
    || body.challengeId.length === 0
    || body.challengeId.length > 256
    || typeof body.address !== 'string'
    || body.address.length === 0
    || body.address.length > 64
    || typeof body.signature !== 'string'
    || body.signature.length === 0
    || body.signature.length > 128
    || typeof body.network !== 'string'
    || body.network !== 'testnet'
    || (body.message !== undefined && (typeof body.message !== 'string' || body.message.length > 2_048))) {
    return invalidEvaluationFields();
  }
  return proxyEvaluationRequest(
    '/v1/evaluation/wallet-proof',
    'POST',
    pickFields(body, WALLET_PROOF_FIELDS),
  );
}
