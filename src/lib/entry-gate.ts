/**
 * Casual exhibition gate shown before permissions. This is a frontend-only check:
 * it does not protect source code, assets, or server endpoints.
 */
export const ENTRY_CODE = "8917";
export const ENTRY_CODE_LENGTH = 4;
export function isEntryCodeValid(code: string) {
  return code === ENTRY_CODE;
}
