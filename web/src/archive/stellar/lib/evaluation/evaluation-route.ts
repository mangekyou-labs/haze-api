import { NextResponse } from 'next/server';

export function invalidEvaluationFields(): NextResponse {
  return NextResponse.json({ error: 'invalid_fields' }, { status: 400 });
}

export function evaluationMethodNotAllowed(allow: readonly string[]): NextResponse {
  return NextResponse.json(
    { error: 'method_not_allowed' },
    { status: 405, headers: { Allow: allow.join(', ') } },
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function pickFields(
  input: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter((field) => input[field] !== undefined)
      .map((field) => [field, input[field]]),
  );
}
