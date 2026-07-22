/**
 * Hook para buscar grupos do WhatsApp conectado.
 *
 * Suporta:
 * - Carregamento inicial automático
 * - Refresh manual com ?force=true para bypass do cache
 * - Polling automático a cada 60s
 * - Estado separating entre loading inicial e refreshing
 */
import { useState, useCallback, useEffect, useRef } from 'react';

interface WhatsAppGroup {
  jid: string;
  name: string;
}

interface UseWhatsAppGroupsResult {
  groups: WhatsAppGroup[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (force?: boolean) => void;
}

export function useWhatsAppGroups(token: string, pollIntervalMs = 60000): UseWhatsAppGroupsResult {
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchGroups = useCallback(async (force = false) => {
    // Se já carregou antes, marca como refreshing em vez de loading
    if (groups.length > 0 || !loading) {
      setRefreshing(true);
    }
    setError(null);

    try {
      const url = force ? '/api/whatsapp/groups?force=true' : '/api/whatsapp/groups';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as {
        success: boolean;
        groups?: WhatsAppGroup[];
        error?: string;
      };

      if (!mountedRef.current) return;

      if (data.success && data.groups) {
        setGroups(data.groups);
      } else {
        setError(data.error || 'Falha ao carregar grupos');
      }
    } catch {
      if (mountedRef.current) {
        setError('Erro de conexão ao carregar grupos');
      }
    }

    if (mountedRef.current) {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, groups.length, loading]);

  // Carrega grupos ao montar
  useEffect(() => {
    mountedRef.current = true;
    fetchGroups();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Polling automático
  useEffect(() => {
    const interval = setInterval(() => {
      fetchGroups();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchGroups, pollIntervalMs]);

  const refresh = useCallback(
    (force = false) => {
      fetchGroups(force);
    },
    [fetchGroups],
  );

  return { groups, loading, refreshing, error, refresh };
}
