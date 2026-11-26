/**
 * `/version.json`, written by the bake (`VersionInfo` in `@weddingplanner/content`): which commit
 * and which content a deployment serves. Parsed by hand to keep zod out of the e2e package.
 */
export type VersionInfo = {
  readonly sha: string;
  readonly builtAt: string;
  readonly contentHash: string;
  readonly isSample: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the shape of `/version.json`. The message names the field, never a value. */
export function parseVersionInfo(json: unknown): VersionInfo {
  if (!isRecord(json)) throw new Error('/version.json is not a JSON object');
  const { sha, builtAt, contentHash, isSample } = json;
  if (typeof sha !== 'string' || sha === '') throw new Error('/version.json has no sha');
  if (typeof builtAt !== 'string' || Number.isNaN(Date.parse(builtAt))) {
    throw new Error('/version.json has no valid builtAt');
  }
  if (typeof contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new Error('/version.json has no valid contentHash');
  }
  if (typeof isSample !== 'boolean') throw new Error('/version.json has no boolean isSample');
  return { sha, builtAt, contentHash, isSample };
}
