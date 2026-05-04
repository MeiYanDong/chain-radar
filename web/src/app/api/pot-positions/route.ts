export const dynamic = 'force-dynamic';

interface PotPositionApi {
  pair: string;
  side: 'long' | 'short';
  entryPrice: number;
  notionalSize: number;
  unrealizedPnl: number;
  leverage: number;
}

interface PotSeasonApi {
  copyTradeAgentName?: string;
  tokenSymbol?: string | null;
  status?: string;
  startingCapital?: number;
  currentValue?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  positions?: PotPositionApi[];
}

interface PotAgentApi {
  id: string;
  name: string;
  status?: string;
  currentSeason?: PotSeasonApi | null;
}

export async function GET() {
  const res = await fetch('https://degen.virtuals.io/api/pot-agents', {
    next: { revalidate: 30 },
  });
  const json = (await res.json()) as { data?: PotAgentApi[] };

  const agents = (json.data ?? []).map((agent) => {
    const season = agent.currentSeason;
    return {
      agentId: agent.id,
      agentName: season?.copyTradeAgentName ?? agent.name,
      tokenSymbol: season?.tokenSymbol ?? null,
      status: season?.status ?? agent.status,
      startingCapital: season?.startingCapital ?? 0,
      currentValue: season?.currentValue ?? 0,
      realizedPnl: season?.realizedPnl ?? 0,
      unrealizedPnl: season?.unrealizedPnl ?? 0,
      positions: (season?.positions ?? []).map((p) => ({
        pair: p.pair,
        side: p.side,
        entryPrice: p.entryPrice,
        notionalSize: p.notionalSize,
        unrealizedPnl: p.unrealizedPnl,
        leverage: p.leverage,
      })),
    };
  });

  return Response.json({ agents });
}
