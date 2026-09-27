import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-gray-600">That Stellar Launch page does not exist.</p>
        <Link className="mt-5 inline-block min-h-11 rounded bg-blue-600 px-4 py-3 text-sm font-medium text-white" href="/dashboard">Return to dashboard</Link>
      </div>
    </main>
  );
}
