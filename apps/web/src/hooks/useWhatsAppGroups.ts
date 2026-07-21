/**
 * Hook para buscar grupos do WhatsApp conectado.
 */
import { useState, useCallback, useEffect } from 'react';

interface WhatsAppGroup {
  jid: string;
  name: string;
}

interface UseWhatsAppGroupsResult {
  groups: WhatsAppGroup[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useWhatsAppGroups(token: string): UseWhatsAppGroupsResult {
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/groups', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as {
        success: boolean;
        groups?: WhatsAppGroup[];
        error?: string;
      };

      if (data.success && data.groups) {
        setGroups(data.groups);
      } else {
        setError(data.error || 'Falha ao carregar grupos');
      }
    } catch {
      setError('Erro de conexão ao carregar grupos');
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  return { groups, loading, error, refresh: fetchGroups };
}
