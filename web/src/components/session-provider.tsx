'use client';

import { SessionProvider, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { initializeAnalytics, resetAnalytics } from '@/lib/analytics';

function AnalyticsSessionBoundary() {
  const { status } = useSession();
  useEffect(() => {
    initializeAnalytics();
    if (status === 'unauthenticated') resetAnalytics();
  }, [status]);
  return null;
}

export default function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AnalyticsSessionBoundary />
      {children}
    </SessionProvider>
  );
}
