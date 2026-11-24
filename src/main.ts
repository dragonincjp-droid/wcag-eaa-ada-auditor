import { pathToFileURL } from 'node:url';
import { ApifyRuntimeAdapter } from './apifyRuntime.js';
import { runBatchAudit } from './auditor.js';
import { startStandbyServer } from './server.js';

export function isStandbyMode(argv: string[] = process.argv): boolean {
  return (
    process.env.APIFY_META_ORIGIN === 'STANDBY' ||
    argv.includes('--standby')
  );
}

export async function main(): Promise<void> {
  const runtime = new ApifyRuntimeAdapter();
  await runtime.init();

  if (isStandbyMode()) {
    const handle = await startStandbyServer({ runtime });
    console.log(
      `[wcag-eaa-ada-auditor] Standby HTTP & MCP Server listening on port ${handle.port} (GET /health, POST /scan, POST /mcp)`,
    );

    const shutdown = async (signal: string): Promise<void> => {
      console.log(`[wcag-eaa-ada-auditor] Received ${signal}, shutting down Standby server...`);
      await handle.close();
      await runtime.exit(0);
      process.exit(0);
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    return;
  }

  const rawInput = await runtime.getInput();
  const result = await runBatchAudit(rawInput, { runtime });

  console.log(
    `[wcag-eaa-ada-auditor] Completed batch audit via engine=${result.engineName}: ` +
      `urlsProcessed=${result.items.length}, ` +
      `estimatedPpeUsd=$${result.billing.estimatedTotalUsd.toFixed(4)}, ` +
      `stoppedDueToBudgetCap=${result.stoppedDueToBudgetCap}`,
  );

  await runtime.exit(0);
}

const isDirectExecution =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch(async (err) => {
    console.error('[wcag-eaa-ada-auditor] Fatal error:', err);
    process.exitCode = 1;
  });
}
