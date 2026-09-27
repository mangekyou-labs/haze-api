'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen grid place-items-center p-6" role="alert">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-gray-600">The app could not finish that request. You can retry without losing local keys.</p>
        <button type="button" onClick={() => reset()} className="mt-5 min-h-11 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
      </div>
    </main>
  );
}
