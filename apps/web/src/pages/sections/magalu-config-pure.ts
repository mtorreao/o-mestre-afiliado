export type MagaluSlugValidation = { valid: true } | { valid: false; reason: string };

const MAGALU_STORE_SLUG_REGEX = /^[a-z0-9-]{3,40}$/;

export function validateMagaluStoreSlug(slug: string): MagaluSlugValidation {
  if (slug.length < 3 || slug.length > 40) {
    return { valid: false, reason: 'O slug deve ter entre 3 e 40 caracteres.' };
  }

  if (!MAGALU_STORE_SLUG_REGEX.test(slug)) {
    return { valid: false, reason: 'Use apenas letras minúsculas, números e hífen.' };
  }

  return { valid: true };
}
