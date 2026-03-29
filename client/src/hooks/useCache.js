import { useState, useEffect, useRef, useCallback } from 'react';

const cache = new Map(); // key -> { data, timestamp }

/**
 * Hook de cache con stale-while-revalidate.
 * Devuelve datos inmediatos del cache si existen, y revalida en background.
 *
 * @param {string} key  — clave unica del cache (ej. 'planContable-1')
 * @param {Function} fetcher — función async que obtiene los datos
 * @param {object} opts — { ttl: ms (default 5min), enabled: bool }
 * @returns {{ data, loading, error, invalidate }}
 */
export default function useCache(key, fetcher, { ttl = 5 * 60 * 1000, enabled = true } = {}) {
  const cached = cache.get(key);
  const [data, setData]       = useState(cached?.data ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError]     = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const revalidate = useCallback(async () => {
    try {
      setLoading(prev => !cache.get(key) ? true : prev); // solo loading si no hay cache
      const fresh = await fetcherRef.current();
      cache.set(key, { data: fresh, timestamp: Date.now() });
      setData(fresh);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled || !key) return;
    const entry = cache.get(key);
    if (entry) {
      setData(entry.data);
      // Si es stale, revalidar en background
      if (Date.now() - entry.timestamp > ttl) revalidate();
      else setLoading(false);
    } else {
      revalidate();
    }
  }, [key, enabled, ttl, revalidate]);

  const invalidate = useCallback(() => {
    cache.delete(key);
    revalidate();
  }, [key, revalidate]);

  return { data, loading, error, invalidate };
}
