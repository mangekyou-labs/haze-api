import type { Metadata } from 'next';
import AuthSessionProvider from '@/components/session-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Haze Credits',
  description:
    'API credits for Codex, Cline, and x402 agents. Prove each spend locally with Haze Credits on Base Sepolia.',
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
