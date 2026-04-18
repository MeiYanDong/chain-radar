import { getWalletNames, setWalletName } from '@/lib/db';
import type { NextRequest } from 'next/server';

export async function GET() {
  const names = getWalletNames();
  return Response.json(names);
}

export async function POST(request: NextRequest) {
  const { address, name } = await request.json();
  if (!address || typeof address !== 'string') {
    return Response.json({ error: 'address required' }, { status: 400 });
  }
  setWalletName(address, name || '');
  return Response.json({ ok: true });
}
