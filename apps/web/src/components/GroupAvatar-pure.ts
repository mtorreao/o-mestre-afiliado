/**
 * GroupAvatar-pure — funções puras (sem React) para o GroupAvatar.
 */
export function getGroupInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const match = trimmed.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/);
  const candidate = match ? match[0] : trimmed[0];
  return candidate!.toUpperCase();
}

export function shouldShowGroupImage(
  pictureUrl: string | null | undefined,
  errored: boolean,
): boolean {
  return Boolean(pictureUrl) && !errored;
}
