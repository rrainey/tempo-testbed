// app/formation/[id]/page.tsx — legacy URL.
// The formation view moved into the test-case subtree; keep old links working.
import { redirect } from 'next/navigation';

export default async function LegacyFormationRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/testcase/${encodeURIComponent(id)}/formation`);
}
