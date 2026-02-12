// app/api/testcases/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { loadTestCase } from '@/lib/testbed/data-loader';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const testCase = loadTestCase(id);
    if (!testCase) {
      return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
    }
    return NextResponse.json({ testCase });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to load test case: ${error}` },
      { status: 500 }
    );
  }
}
