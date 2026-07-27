/**
 * MaintenancePage — Tela full-screen de manutenção.
 * Exibida para usuários comuns quando maintenance_mode está ativa.
 */
export function MaintenancePage() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        textAlign: 'center',
        background: 'var(--color-bg)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🔧</div>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: '0.5rem' }}>
        Em manutenção
      </h1>
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)', maxWidth: '400px' }}>
        O sistema está passando por uma manutenção programada.
        Voltamos já!
      </p>
    </div>
  );
}
