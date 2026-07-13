// app/testcase/[id]/jumper/[name]/page.tsx — one jumper's analysis.
//
// Thin route: the shell (header + tabs) comes from the parent layout, the
// content is the single shared JumperAnalysis component.
'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { JumperAnalysis } from '@/components/testbed/JumperAnalysis';

export default function JumperAnalysisPage() {
  const params = useParams();
  const jumperName = decodeURIComponent(params.name as string);
  return <JumperAnalysis jumperName={jumperName} />;
}
