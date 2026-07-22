// Stub — this module is mocked in tests
export async function tryAcquireSlot(): Promise<{ acquired: boolean; waitMs: number }> {
  return { acquired: true, waitMs: 0 };
}
export async function waitForSlot(): Promise<boolean> { return true; }
