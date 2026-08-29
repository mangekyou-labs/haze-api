import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { OnboardingWizard } from './onboarding-wizard';

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1 px-6 py-12">
        <OnboardingWizard />
      </div>
      <SiteFooter />
    </main>
  );
}
