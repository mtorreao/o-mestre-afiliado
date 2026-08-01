export interface WhatsAppGroupWithAdmin {
  jid: string;
  name: string;
  isAdmin: boolean;
  pictureUrl: string | null;
}

export function filterWhatsAppGroupsByAdmin(
  groups: readonly WhatsAppGroupWithAdmin[],
  adminOnly: boolean,
): WhatsAppGroupWithAdmin[] {
  return adminOnly ? groups.filter((group) => group.isAdmin) : [...groups];
}
