'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';

export function AddressSearch({ tokenId = 'fat' }: { tokenId?: string }) {
  const [query, setQuery] = useState('');
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const addr = query.trim().toLowerCase();
    if (addr.startsWith('0x') && addr.length === 42) {
      router.push(`/address/${addr}?token=${tokenId}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md">
      <Input
        placeholder="Search address (0x...)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
      />
    </form>
  );
}
