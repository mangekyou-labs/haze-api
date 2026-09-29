export function formatDate(timestamp: number | null): string {
  if (!timestamp) return 'Pending';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(timestamp * 1000));
}
