// app/api/testcases/route.ts
import { NextResponse } from 'next/server';
import { listTestCases } from '@/lib/testbed/data-loader';

export async function GET() {
  try {
    const cases = listTestCases();
    return NextResponse.json({ testCases: cases });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to list test cases: ${error}` },
      { status: 500 }
    );
  }
}
