import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { RecoverForm } from './recover-form';

export default function RecoverPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1 px-6 py-12">
        <RecoverForm />
      </div>
      <SiteFooter />
    </main>
  );
}
