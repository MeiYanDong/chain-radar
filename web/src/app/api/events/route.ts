import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();
  let lastSeen = '';
  let intervalId: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: connected\ndata: ok\n\n'));

      intervalId = setInterval(() => {
        try {
          const db = getDb();
          const rows = db.prepare("SELECT key, value FROM meta WHERE key LIKE '%_last_updated'").all() as
            { key: string; value: string }[];
          const current = rows.map(r => r.value).sort().join(',');

          if (current && current !== lastSeen) {
            lastSeen = current;
            controller.enqueue(
              encoder.encode(`event: update\ndata: ${JSON.stringify({ timestamp: current })}\n\n`)
            );
          }
        } catch {
          // DB not ready, skip
        }
      }, 2000);
    },
    cancel() {
      clearInterval(intervalId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
