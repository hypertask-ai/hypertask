import floor from "./nodeSecurityFloor.json";

export const NODE_SECURITY_FLOOR: string = floor.minimum;

function versionParts(version: string): number[] {
  return version.replace(/^v/, "").split(".").map(Number);
}

export function meetsNodeSecurityFloor(version: string, minimum: string = NODE_SECURITY_FLOOR): boolean {
  const actual = versionParts(version);
  const required = versionParts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}
