// Stub — this module is mocked in tests
export async function runRevalidation(): Promise<{ totalAffiliates: number; validatedAffiliates: number; failedAffiliates: number; results: Array<{ affiliateId: number; groupStatuses: unknown[] }> }> {
  return { totalAffiliates: 0, validatedAffiliates: 0, failedAffiliates: 0, results: [] };
}
export async function runRevalidationDaemon(): Promise<void> {}
