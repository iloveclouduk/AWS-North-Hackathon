// DOM-free so the server (server/) can apply the same rule to model output.

/** Controls the agent may never press itself (the player must). Case-insensitive, word-ish match. */
const RISKY = [
  /\bdelete\b/, /\bterminate\b/, /\bremove\b/, /\bpurge\b/, /\bdestroy\b/, /\bempty\b/, /\bdisable\b/, /\bdeactivate\b/,
  /make public/, /\bpublic access\b.*\b(off|disable)/, /attach (policy|policies)/, /administratoraccess/, /\bfull ?access\b/,
  /create access key/, /\baccess keys?\b/, /\bsecret\b/, /\bpassword\b/, /\bmfa\b/, /\broot\b/,
  /\bbilling\b/, /\bpayment\b/, /\bpurchase\b/, /\bbuy\b/, /\bsubscribe\b/, /reserved instance/, /savings plan/, /\bupgrade\b/,
  /sign ?out/, /close account/, /account settings/, /\btransfer\b/,
];

export function isRisky(name: string, context = ''): boolean {
  const s = `${name} ${context}`.toLowerCase();
  return RISKY.some((r) => r.test(s));
}
