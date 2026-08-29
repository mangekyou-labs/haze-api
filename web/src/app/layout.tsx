import type { Metadata } from 'next';
import AuthSessionProvider from '@/components/session-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZK API Credits',
  description: 'Anonymous API credits for coding agents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
