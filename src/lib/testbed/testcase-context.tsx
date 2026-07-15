// lib/testbed/testcase-context.tsx
//
// Shared state for the /testcase/[id] route subtree. The layout mounts one
// provider; the Overview, Formation, and per-jumper pages all consume it, so
// analysis results survive tab navigation and the test case is fetched once.
'use client';

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { notifications } from '@mantine/notifications';

export interface TestCaseData {
  id: string;
  metadata: {
    name: string;
    description: string;
    dropzone: {
      name: string; lat_deg: number; lon_deg: number; elevation_m: number;
      timezone?: string; // IANA zone, written by the promote tool
    };
    jumpers: string[];
    baseJumper: string;
    isSolo: boolean;
    tags: string[];
  };
  jumpers: {
    name: string;
    hasFlightData: boolean;
    baseline: any;
  }[];
  hasBaseline: boolean;
}

export interface AnalysisResult {
  events: any;
  velocityBins: any[] | null;
  velocitySummary: any | null;
  fallRateSeries: { time: number; raw_mph: number | null; calibrated_mph: number | null }[] | null;
  baseline: any;
  diff: any | null;
  accepted: boolean;
  timeSeries: {
    altitude: { timestamp: number; value: number }[];
    vspeed: { timestamp: number; value: number }[];
    gps: any[];
    gpsAltitude: { timestamp: number; value: number }[];
    staticPressure: { timestamp: number; value: number }[];
    acceleration: { timestamp: number; value: number }[];
    duration: number;
    sampleRate: number;
    hasGPS: boolean;
    logVersion: number;
    logString: string;
    dzSurfacePressureAltitude_m: number;
  };
}

export type DiffStatus = 'unchanged' | 'improved' | 'regressed' | 'changed' | 'new' | 'lost';

interface TestCaseContextValue {
  testCaseId: string;
  testCase: TestCaseData | null;
  loading: boolean;
  error: string | null;
  analysisResults: Record<string, AnalysisResult>;
  analyzing: Record<string, boolean>;
  anyAnalyzing: boolean;
  analyzeJumper: (jumperName: string, accept?: boolean) => Promise<void>;
  analyzeAll: () => Promise<void>;
  acceptAll: () => Promise<void>;
}

const TestCaseContext = createContext<TestCaseContextValue | null>(null);

export function useTestCase(): TestCaseContextValue {
  const ctx = useContext(TestCaseContext);
  if (!ctx) throw new Error('useTestCase must be used inside <TestCaseProvider>');
  return ctx;
}

export function TestCaseProvider({
  testCaseId, children,
}: {
  testCaseId: string;
  children: React.ReactNode;
}) {
  const [testCase, setTestCase] = useState<TestCaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, AnalysisResult>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(`/api/testcases/${testCaseId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setTestCase(data.testCase);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [testCaseId]);

  const analyzeJumper = useCallback(async (jumperName: string, accept = false) => {
    setAnalyzing(prev => ({ ...prev, [jumperName]: true }));
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCaseId, jumperName, accept }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setAnalysisResults(prev => ({ ...prev, [jumperName]: data }));

      if (accept) {
        notifications.show({
          message: `Baseline saved for ${jumperName}`,
          color: 'green',
        });
        // Reload test case to reflect updated baseline
        const tcResponse = await fetch(`/api/testcases/${testCaseId}`);
        const tcData = await tcResponse.json();
        if (tcData.testCase) setTestCase(tcData.testCase);
      }
    } catch (err) {
      notifications.show({
        title: 'Analysis failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        color: 'red',
      });
    } finally {
      setAnalyzing(prev => ({ ...prev, [jumperName]: false }));
    }
  }, [testCaseId]);

  const analyzeAll = useCallback(async () => {
    if (!testCase) return;
    for (const jumper of testCase.jumpers) {
      if (jumper.hasFlightData) {
        await analyzeJumper(jumper.name);
      }
    }
  }, [testCase, analyzeJumper]);

  const acceptAll = useCallback(async () => {
    if (!testCase) return;
    for (const jumper of testCase.jumpers) {
      if (jumper.hasFlightData && analysisResults[jumper.name]) {
        await analyzeJumper(jumper.name, true);
      }
    }
  }, [testCase, analysisResults, analyzeJumper]);

  const anyAnalyzing = Object.values(analyzing).some(Boolean);

  const value = useMemo(() => ({
    testCaseId, testCase, loading, error,
    analysisResults, analyzing, anyAnalyzing,
    analyzeJumper, analyzeAll, acceptAll,
  }), [testCaseId, testCase, loading, error, analysisResults, analyzing,
       anyAnalyzing, analyzeJumper, analyzeAll, acceptAll]);

  return <TestCaseContext.Provider value={value}>{children}</TestCaseContext.Provider>;
}
