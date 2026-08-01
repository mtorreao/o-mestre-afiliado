/**
 * GroupAvatar — avatar circular usado nos itens do dropdown de grupos.
 *
 * Usa a `pictureUrl` retornada pela API; se ausente ou com erro de carga,
 * cai para um placeholder cinza com a inicial do nome.
 */
import { useState } from 'react';
import { getGroupInitial, shouldShowGroupImage } from './GroupAvatar-pure.ts';

interface GroupAvatarProps {
  name: string;
  pictureUrl: string | null;
  size?: number;
}

export function GroupAvatar({ name, pictureUrl, size = 20 }: GroupAvatarProps) {
  const [errored, setErrored] = useState(false);
  const showImage = shouldShowGroupImage(pictureUrl, errored);

  if (showImage) {
    return (
      <img
        src={pictureUrl!}
        alt=""
        width={size}
        height={size}
        onError={() => setErrored(true)}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          background: '#0f172a',
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#1e293b',
        color: '#94a3b8',
        fontSize: Math.max(10, size * 0.5),
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {getGroupInitial(name)}
    </span>
  );
}
