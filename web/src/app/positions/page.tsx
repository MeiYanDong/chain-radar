import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

interface Position {
  pair: string;
  side: 'long' | 'short';
  entryPrice: number;
  notionalSize: number;
  unrealizedPnl: number;
  leverage: number;
}

interface Agent {
  agentId: string;
  agentName: string;
  tokenSymbol: string | null;
  status: string;
  startingCapital: number;
  currentValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  positions: Position[];
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtPrice(n: number) {
  return n < 1 ? n.toFixed(5) : n.toFixed(2);
}

export default async function PositionsPage() {
  const res = await fetch('http://localhost:3000/api/pot-positions', { cache: 'no-store' });
  const { agents }: { agents: Agent[] } = await res.json();

  const activeAgents = agents.filter(a => a.positions.length > 0);
  const allPositions = activeAgents.flatMap(a =>
    a.positions.map(p => ({ ...p, agentName: a.agentName, tokenSymbol: a.tokenSymbol }))
  );

  const totalUnrealized = agents.reduce((s, a) => s + a.unrealizedPnl, 0);
  const totalRealized = agents.reduce((s, a) => s + a.realizedPnl, 0);
  const totalValue = agents.reduce((s, a) => s + a.currentValue, 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-zinc-400 hover:text-zinc-200 flex items-center gap-1 text-sm">
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <div>
          <h1 className="text-2xl font-bold">AI Pot — Open Positions</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Season 3 · {activeAgents.length} agents trading · {allPositions.length} open positions
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-4">
            <p className="text-xs text-zinc-400">Combined Value</p>
            <p className="text-xl font-mono font-bold text-zinc-100">{fmt(totalValue)}</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-4">
            <p className="text-xs text-zinc-400">Unrealized P&L</p>
            <p className={`text-xl font-mono font-bold ${totalUnrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmt(totalUnrealized)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-4">
            <p className="text-xs text-zinc-400">Realized P&L</p>
            <p className={`text-xl font-mono font-bold ${totalRealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmt(totalRealized)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Per-agent positions */}
      {activeAgents.map(agent => (
        <Card key={agent.agentId} className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-zinc-100 text-base">
                {agent.agentName}
                {agent.tokenSymbol && (
                  <span className="ml-2 text-xs text-zinc-500 font-normal">${agent.tokenSymbol}</span>
                )}
              </CardTitle>
              <div className="flex gap-4 text-sm font-mono">
                <span className="text-zinc-400">Capital: {fmt(agent.startingCapital)}</span>
                <span className={agent.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  Unrealized: {fmt(agent.unrealizedPnl)}
                </span>
                <span className={agent.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  Realized: {fmt(agent.realizedPnl)}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Pair</TableHead>
                  <TableHead className="text-zinc-400">Side</TableHead>
                  <TableHead className="text-zinc-400 text-right">Entry Price</TableHead>
                  <TableHead className="text-zinc-400 text-right">Notional Size</TableHead>
                  <TableHead className="text-zinc-400 text-right">Leverage</TableHead>
                  <TableHead className="text-zinc-400 text-right">Unrealized P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agent.positions.map((p, i) => (
                  <TableRow key={i} className="border-zinc-800 hover:bg-zinc-800/50">
                    <TableCell className="text-zinc-100 font-mono font-medium">{p.pair}</TableCell>
                    <TableCell>
                      <span className={`flex items-center gap-1 text-sm font-medium ${p.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {p.side === 'long' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {p.side.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell className="text-zinc-300 text-right font-mono">${fmtPrice(p.entryPrice)}</TableCell>
                    <TableCell className="text-zinc-300 text-right font-mono">{fmt(p.notionalSize)}</TableCell>
                    <TableCell className="text-zinc-400 text-right font-mono">{p.leverage}x</TableCell>
                    <TableCell className={`text-right font-mono ${p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmt(p.unrealizedPnl)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {activeAgents.length === 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-12 text-center text-zinc-500">
            No open positions found.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
