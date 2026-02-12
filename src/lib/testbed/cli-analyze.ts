// lib/testbed/cli-analyze.ts
// CLI tool: npm run analyze / npm run analyze:accept

import { listTestCases, loadFlightData, loadTestCase, saveBaseline } from './data-loader';
import { runAnalysis } from './analysis-runner';
import { diffBaselines, summarizeDiff } from './diff-engine';

const acceptFlag = process.argv.includes('--accept');

async function main() {
  console.log('=== Tempo Testbed — CLI Analyzer ===\n');

  const testCases = listTestCases();
  if (testCases.length === 0) {
    console.log('No test cases found in test-data/');
    process.exit(1);
  }

  console.log(`Found ${testCases.length} test case(s)\n`);

  let totalJumpers = 0;
  let totalAnalyzed = 0;
  let totalErrors = 0;

  for (const tc of testCases) {
    console.log(`── ${tc.id}: ${tc.metadata.name} ──`);

    const detail = loadTestCase(tc.id);
    if (!detail) {
      console.log('  ERROR: Could not load test case detail\n');
      totalErrors++;
      continue;
    }

    for (const jumper of detail.jumpers) {
      totalJumpers++;

      if (!jumper.hasFlightData) {
        console.log(`  ${jumper.name}: no flight.txt — skipped`);
        continue;
      }

      try {
        const rawLog = loadFlightData(tc.id, jumper.name);
        if (!rawLog) {
          console.log(`  ${jumper.name}: could not read flight data — skipped`);
          continue;
        }

        const result = runAnalysis(rawLog);
        totalAnalyzed++;

        // Print event summary
        const e = result.events;
        console.log(`  ${jumper.name}:`);
        console.log(`    Exit:       ${e.exitOffsetSec != null ? `${e.exitOffsetSec.toFixed(1)}s @ ${e.exitAltitudeFt?.toLocaleString() ?? '?'} ft` : 'not detected'}`);
        console.log(`    Deploy:     ${e.deploymentOffsetSec != null ? `${e.deploymentOffsetSec.toFixed(1)}s @ ${e.deployAltitudeFt?.toLocaleString() ?? '?'} ft` : 'not detected'}`);
        console.log(`    Landing:    ${e.landingOffsetSec != null ? `${e.landingOffsetSec.toFixed(1)}s` : 'not detected'}`);
        console.log(`    Max RoD:    ${e.maxDescentRateFpm != null ? `${Math.round(e.maxDescentRateFpm)} fpm (${Math.round(e.maxDescentRateFpm / 88)} mph)` : 'N/A'}`);

        if (result.velocitySummary) {
          const vs = result.velocitySummary;
          console.log(`    Vel Bins:   ${vs.analysisWindow.duration.toFixed(0)}s window, avg ${vs.raw.averageFallRate} mph raw / ${vs.calibrated.averageFallRate} mph cal`);
        }

        // Compare against existing baseline
        if (jumper.baseline && jumper.baseline.analyzedAt) {
          const diff = diffBaselines(jumper.baseline, result.baseline, tc.id, jumper.name);
          console.log(`    Diff:       ${summarizeDiff(diff)} [${diff.overallStatus}]`);
        } else {
          console.log(`    Diff:       (no existing baseline)`);
        }

        // Save baseline if --accept
        if (acceptFlag) {
          saveBaseline(tc.id, jumper.name, result.baseline);
          console.log(`    ✓ Baseline saved`);
        }
      } catch (err) {
        console.log(`  ${jumper.name}: ERROR — ${err instanceof Error ? err.message : err}`);
        totalErrors++;
      }
    }

    console.log('');
  }

  console.log('=== Summary ===');
  console.log(`  Test cases: ${testCases.length}`);
  console.log(`  Jumpers:    ${totalJumpers}`);
  console.log(`  Analyzed:   ${totalAnalyzed}`);
  console.log(`  Errors:     ${totalErrors}`);
  if (acceptFlag) {
    console.log(`  Baselines:  SAVED`);
  } else {
    console.log(`  Baselines:  dry run (use --accept to save)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
