import { NextRequest } from 'next/server';
import { evaluationMethodNotAllowed } from '../../evaluation-route';

export async function POST(_req: NextRequest) {
  return evaluationMethodNotAllowed(['OPTIONS']);
}
