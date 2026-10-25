const ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";

export function generateTableCode(): string {
  let code = "";
  // Reject the biased remainder rather than mapping every byte with modulo.
  const limit = 256 - (256 % ALPHABET.length);
  while (code.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    for (const byte of bytes) {
      if (byte < limit) code += ALPHABET[byte % ALPHABET.length];
      if (code.length === 6) break;
    }
  }
  return code;
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}
