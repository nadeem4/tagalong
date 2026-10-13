/**
 * Hides keys, tokens, passwords and card numbers in text before it leaves the machine.
 *
 * The last line of the built-in blind spots: a window rule only works when the title names
 * the file, so whatever slips past it is still caught here, on the way out. Each secret is
 * replaced with a marker that says what was there, so the model knows something was hidden
 * rather than seeing a gap.
 *
 * Errs towards hiding: a false positive costs a word of context, a false negative costs a
 * leaked key. It still leaves code alone where it can tell, so an expert keeps the
 * identifiers it needs.
 */

const hidden = (kind: string) => `[hidden: ${kind}]`;

/** Words that make a setting's value a secret. */
const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*`;

const RULES: readonly {
  pattern: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}[] = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => hidden('private key'),
  },
  {
    // JSON web tokens: three base64url parts, the first two starting with {" encoded.
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: () => hidden('login token'),
  },
  {
    // Anthropic, OpenAI and similar: sk-..., and Stripe's sk_live_ / rk_test_.
    pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|[rs]k_(?:live|test)_[A-Za-z0-9]{16,})/g,
    replace: () => hidden('API key'),
  },
  {
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,}|xox[abprs]-[A-Za-z0-9-]{10,})/g,
    replace: () => hidden('access token'),
  },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: () => hidden('access key') },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}/g, replace: () => hidden('API key') },
  {
    // scheme://user:password@host keeps the user and the host.
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@]+)(@)/gi,
    replace: (_match, before = '', _password, at = '') => `${before}${hidden('password')}${at}`,
  },
  {
    // .env lines: NAME=value at the start of a line, quoted or not.
    pattern: new RegExp(
      String.raw`^(\s*(?:export\s+)?${SECRET_NAME}\s*=\s*)(["']?)([^\s"'#]+)\2`,
      'gim',
    ),
    replace: (_match, before = '', quote = '') => `${before}${quote}${hidden('secret')}${quote}`,
  },
  {
    // name = "value" or name: 'value' in code and config. Only quoted values: an unquoted
    // one is code (props.password), which an expert needs to read.
    pattern: new RegExp(String.raw`(\b${SECRET_NAME}["']?\s*[:=]\s*)(["'])([^"'\s]{4,})\2`, 'gi'),
    replace: (_match, before = '', quote = '') => `${before}${quote}${hidden('secret')}${quote}`,
  },
  {
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    replace: (match) => (passesLuhn(match.replace(/\D/g, '')) ? hidden('card number') : match),
  },
];

export function hideSecrets(text: string): string {
  return RULES.reduce(
    (out, rule) =>
      out.replace(rule.pattern, (match, ...groups: unknown[]) =>
        rule.replace(match, ...groups.filter((g): g is string => typeof g === 'string')),
      ),
    text,
  );
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
