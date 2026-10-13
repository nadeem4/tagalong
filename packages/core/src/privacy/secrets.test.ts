import { describe, expect, it } from 'vitest';
import { hideSecrets } from './secrets';

describe('hideSecrets', () => {
  it('hides API keys and tokens, saying what was there', () => {
    const cases: [string, string][] = [
      ['key sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'API key'],
      ['sk-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'API key'],
      ['ghp' + '_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'access token'],
      ['github' + '_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', 'access token'],
      ['AKIA' + 'IOSFODNN7EXAMPLE', 'access key'],
      ['xox' + 'b-1234567890-abcdefghijklmn', 'access token'],
      ['AIza' + 'SyA1234567890abcdefghijklmnopqrstuv', 'API key'],
      ['sk_' + 'live_51H8abcdefghijklmnopqrstuv', 'API key'],
      [
        'eyJhbGciOiJIUzI1NiJ9.' +
          'eyJzdWIiOiIxMjM0NTY3ODkwIn0.' +
          'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        'login token',
      ],
    ];
    for (const [text, kind] of cases) {
      const out = hideSecrets(text);
      expect(out, text).toContain(`[hidden: ${kind}]`);
      expect(out, text).not.toMatch(/AbCdEfGh|IOSFODNN|abcdefghijklmn|SyA1234|dozjgNry/);
    }
  });

  it('hides a private key block whole', () => {
    const pem = [
      '-----BEGIN OPENSSH ' + 'PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
      '-----END OPENSSH ' + 'PRIVATE KEY-----',
    ].join('\n');
    expect(hideSecrets(`before\n${pem}\nafter`)).toBe('before\n[hidden: private key]\nafter');
  });

  it('hides the password in a connection string and keeps the rest', () => {
    expect(hideSecrets('postgres://admin:' + 'hunter2pass@db.local:5432/app')).toBe(
      'postgres://admin:[hidden: password]@db.local:5432/app',
    );
  });

  it('hides the values of secret settings in .env lines, keeping the names', () => {
    const env = [
      'DATABASE_PASSWORD=hunter2pass',
      'export API_KEY="abc123def456"',
      'PORT=3000',
    ].join('\n');
    expect(hideSecrets(env)).toBe(
      ['DATABASE_PASSWORD=[hidden: secret]', 'export API_KEY="[hidden: secret]"', 'PORT=3000'].join(
        '\n',
      ),
    );
  });

  it('hides a quoted secret value in code or config, not an identifier', () => {
    expect(hideSecrets('const password = "hunter2pass";')).toBe(
      'const password = "[hidden: secret]";',
    );
    expect(hideSecrets("client_secret: 'abc123def456'")).toBe("client_secret: '[hidden: secret]'");
    // A variable read is code the expert needs, not a secret.
    expect(hideSecrets('const password = props.password;')).toBe(
      'const password = props.password;',
    );
  });

  it('hides card numbers that pass the Luhn check, and leaves other long numbers', () => {
    expect(hideSecrets('card 4111 1111 1111 1111 exp')).toBe('card [hidden: card number] exp');
    expect(hideSecrets('order 1234 5678 9012 3456')).toBe('order 1234 5678 9012 3456');
  });

  it('leaves ordinary text alone', () => {
    const text = 'Why does engine.test.ts fail? See https://github.com/nadeem4/tagalong/pull/58';
    expect(hideSecrets(text)).toBe(text);
  });
});
