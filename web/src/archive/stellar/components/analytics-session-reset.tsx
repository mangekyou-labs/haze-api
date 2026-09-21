'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { resetAnalytics } from '@/lib/analytics';

export function shouldResetAnalytics(status: string): boolean {
  return status === 'unauthenticated';
}
export default function AnalyticsSessionReset() {
  const { status } = useSession();

  useEffect(() => {
    if (shouldResetAnalytics(status)) resetAnalytics();
  }, [status]);

  return null;
}
