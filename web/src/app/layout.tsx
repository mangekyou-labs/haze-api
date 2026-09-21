import type { Metadata } from 'next';
import AuthSessionProvider from '@/components/session-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZK API Credits',
  description:
    'Invite-only, unpaid, experimental Base Sepolia pilot for private prepaid API credits with the x402 zk-prepaid scheme. Not independently audited.',
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
