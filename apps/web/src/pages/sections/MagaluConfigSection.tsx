import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink, ShoppingCart, Trash2 } from 'lucide-react';
import { Button, Card, Input, Loading } from '@omestre/ui';
import { showErrorToast, showSuccessToast } from '@omestre/ui';
import { validateMagaluStoreSlug } from './magalu-config-pure.ts';

export interface MagaluAffiliateInfo {
  connected: true;
  id?: number;
  nickname: string | null;
  storeSlug: string;
  active: boolean;
}

interface MagaluApiAffiliate {
  id: number;
  nickname: string | null;
  storeSlug: string;
  active: boolean;
}

interface MagaluConfigSectionProps {
  token: string;
  initialAffiliate: MagaluAffiliateInfo | null;
  onUpdate: () => void;
}

type SlugTestStatus = 'idle' | 'testing' | 'valid' | 'not-found' | 'unavailable' | 'error';

function toAffiliateInfo(
  affiliate: MagaluApiAffiliate | null | undefined,
): MagaluAffiliateInfo | null {
  return affiliate ? { ...affiliate, connected: true } : null;
}

export function MagaluConfigSection({
  token,
  initialAffiliate,
  onUpdate,
}: MagaluConfigSectionProps) {
  const [affiliate, setAffiliate] = useState<MagaluAffiliateInfo | null>(initialAffiliate);
  const [storeSlug, setStoreSlug] = useState(initialAffiliate?.storeSlug ?? '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [testStatus, setTestStatus] = useState<SlugTestStatus>('idle');

  useEffect(() => {
    setAffiliate(initialAffiliate);
    setStoreSlug(initialAffiliate?.storeSlug ?? '');
    setTouched(false);
    setTestStatus('idle');
  }, [initialAffiliate]);

  const loadAffiliate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/magalu/affiliate', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        success: boolean;
        configured?: boolean;
        affiliate?: MagaluApiAffiliate | null;
        error?: string;
      };
      if (!res.ok || !data.success) {
        showErrorToast('Magalu', data.error || 'Não foi possível carregar a integração');
        return;
      }
      const loaded = data.configured ? toAffiliateInfo(data.affiliate) : null;
      setAffiliate(loaded);
      setStoreSlug(loaded?.storeSlug ?? '');
    } catch {
      showErrorToast('Magalu', 'Não foi possível carregar a integração');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAffiliate();
  }, [loadAffiliate]);

  const normalizedSlug = storeSlug.trim();
  const validation = validateMagaluStoreSlug(normalizedSlug);
  const slugError = touched && !validation.valid ? validation.reason : null;
  const configured = affiliate !== null && affiliate.active;

  async function handleSave() {
    setTouched(true);
    if (!validation.valid) return;
    setSaving(true);
    try {
      const res = await fetch('/api/magalu/affiliate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storeSlug: normalizedSlug }),
      });
      const data = (await res.json()) as {
        success: boolean;
        affiliate?: MagaluApiAffiliate;
        error?: string;
      };
      if (!res.ok || !data.success || !data.affiliate) {
        showErrorToast('Magalu', data.error || 'Não foi possível salvar o slug');
        return;
      }
      setAffiliate(toAffiliateInfo(data.affiliate));
      setStoreSlug(data.affiliate.storeSlug);
      setTouched(false);
      setTestStatus('idle');
      showSuccessToast('Magalu', 'Slug da loja salvo');
      onUpdate();
    } catch {
      showErrorToast('Magalu', 'Erro de conexão');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSlug() {
    setTouched(true);
    if (!validation.valid) return;
    setTesting(true);
    setTestStatus('testing');
    try {
      const res = await fetch(
        `/api/magalu/affiliate/validate-slug?slug=${encodeURIComponent(normalizedSlug)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = (await res.json()) as {
        success: boolean;
        exists?: boolean | null;
        error?: string;
      };
      if (!res.ok || !data.success) {
        setTestStatus('error');
        showErrorToast('Magalu', data.error || 'Não foi possível testar o slug');
      } else if (data.exists === true) {
        setTestStatus('valid');
      } else if (data.exists === false) {
        setTestStatus('not-found');
      } else {
        setTestStatus('unavailable');
      }
    } catch {
      setTestStatus('error');
      showErrorToast('Magalu', 'Erro de conexão ao testar o slug');
    } finally {
      setTesting(false);
    }
  }

  async function handleRemove() {
    if (
      !affiliate ||
      !window.confirm(`Remover o afiliado Magalu com slug "${affiliate.storeSlug}"?`)
    ) {
      return;
    }
    setRemoving(true);
    try {
      const res = await fetch('/api/magalu/affiliate', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !data.success) {
        showErrorToast('Magalu', data.error || 'Não foi possível remover o afiliado');
        return;
      }
      setAffiliate(null);
      setStoreSlug('');
      setTouched(false);
      setTestStatus('idle');
      showSuccessToast('Magalu', 'Afiliado removido');
      onUpdate();
    } catch {
      showErrorToast('Magalu', 'Erro de conexão');
    } finally {
      setRemoving(false);
    }
  }

  function renderTestStatus() {
    if (testStatus === 'valid') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--spacing-2)',
            color: 'var(--color-success)',
          }}
        >
          <CheckCircle2 size={16} /> Slug encontrado no Magazine Você.
        </span>
      );
    }
    if (testStatus === 'not-found') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--spacing-2)',
            color: 'var(--color-error)',
          }}
        >
          <CircleAlert size={16} /> Slug não encontrado. Confira o endereço da sua loja.
        </span>
      );
    }
    if (testStatus === 'unavailable') {
      return (
        <span style={{ color: 'var(--color-warning)' }}>
          Não foi possível confirmar agora. O slug continua válido para salvar.
        </span>
      );
    }
    if (testStatus === 'error') {
      return <span style={{ color: 'var(--color-error)' }}>Não foi possível testar o slug.</span>;
    }
    return null;
  }

  return (
    <Card
      title="Magalu"
      subtitle="Configure o slug da sua loja no Magazine Você"
      action={
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 500,
            color: configured ? 'var(--color-success)' : 'var(--color-text-muted)',
          }}
        >
          {configured ? '✅ Conectado' : '⚪ Não configurado'}
        </span>
      }
    >
      {loading ? (
        <Loading text="Carregando..." size="sm" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
            <ShoppingCart size={20} color="var(--color-primary)" />
            <p
              style={{
                margin: 0,
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-secondary)',
              }}
            >
              Use o nome da sua loja, encontrado no endereço <strong>magazinevoce.com.br</strong>.
            </p>
          </div>
          <Input
            label="Slug da loja (Magazine Você)"
            value={storeSlug}
            onChange={(event) => {
              setStoreSlug(event.target.value);
              setTouched(true);
              setTestStatus('idle');
            }}
            placeholder="magazineseunome"
            error={slugError}
            hint="3 a 40 caracteres: letras minúsculas, números e hífen."
            autoComplete="off"
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 'var(--spacing-3)',
            }}
          >
            <Button onClick={handleSave} loading={saving} type="button">
              Salvar
            </Button>
            <Button
              onClick={handleTestSlug}
              loading={testing}
              disabled={!validation.valid || saving || removing}
              variant="outline"
              icon={<CheckCircle2 size={16} />}
              type="button"
            >
              Testar slug
            </Button>
            {affiliate && (
              <Button
                onClick={handleRemove}
                loading={removing}
                disabled={saving || testing}
                variant="ghost"
                icon={<Trash2 size={16} />}
                type="button"
              >
                Remover
              </Button>
            )}
          </div>
          {testStatus !== 'idle' && testStatus !== 'testing' && (
            <div role="status" style={{ fontSize: 'var(--text-xs)' }}>
              {renderTestStatus()}
            </div>
          )}
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Ainda não tem uma loja?{' '}
            <a
              href="https://www.magazinevoce.com.br/"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--color-primary)' }}
            >
              Acesse o Magazine Você <ExternalLink size={12} style={{ verticalAlign: 'middle' }} />
            </a>
            .
          </p>
        </div>
      )}
    </Card>
  );
}
