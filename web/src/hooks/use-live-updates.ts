'use client';

import { useEffect, useCallback, useState } from 'react';
import type { Holder, Transaction, Summary } from '@/lib/types';

interface DashboardData {
  holders: Holder[];
  transactions: Transaction[];
  summary: Summary;
}

export function useLiveData(initial: DashboardData, tokenId: string = 'fat') {
  const [data, setData] = useState<DashboardData>(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/data?token=${tokenId}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // fetch failed, keep current data
    }
  }, [tokenId]);

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('update', () => {
      refresh();
    });

    es.onerror = () => {};

    return () => es.close();
  }, [refresh]);

  return data;
}
