export async function toSha256String(data: ArrayBuffer): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

export function isSha256String(hash: string): boolean {
  if (hash.length != 64) return false;

  for (let i = 0; i < hash.length; i++) {
    const code = hash.charCodeAt(i);
    if ((code < 48 || 57 < code) && (code < 97 || 102 < code)) return false;
  }

  return true;
}
