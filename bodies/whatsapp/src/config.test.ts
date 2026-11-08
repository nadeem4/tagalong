/** Tests for reading the bridge's settings from the environment the brain hands it. */
import { describe, expect, test } from 'vitest';
import { readConfig } from './config';

const FULL = {
  TAGALONG_WHATSAPP_ACCESS_TOKEN: 'tok-secret',
  TAGALONG_WHATSAPP_APP_SECRET: 'app-secret',
  TAGALONG_WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TAGALONG_WHATSAPP_PHONE_NUMBER_ID: '1234',
  TAGALONG_WHATSAPP_ALLOWED_NUMBER: '15550001111',
  TAGALONG_WHATSAPP_PORT: '5000',
  TAGALONG_BRAIN_ADDR: '10.0.0.2:9',
};

describe('readConfig', () => {
  test('test_reads_all_values', () => {
    expect(readConfig(FULL)).toEqual({
      brainAddr: '10.0.0.2:9',
      accessToken: 'tok-secret',
      appSecret: 'app-secret',
      verifyToken: 'verify-me',
      phoneNumberId: '1234',
      allowedNumber: '15550001111',
      port: 5000,
    });
  });

  test('test_missing_values_are_named_not_shown', () => {
    const { TAGALONG_WHATSAPP_APP_SECRET: _drop, ...rest } = FULL;
    expect(() => readConfig(rest)).toThrow(/TAGALONG_WHATSAPP_APP_SECRET/);
    try {
      readConfig(rest);
    } catch (e) {
      const message = (e as Error).message;
      for (const v of ['tok-secret', 'verify-me', '1234', '15550001111']) {
        expect(message).not.toContain(v);
      }
    }
  });

  test('test_port_and_brain_addr_default', () => {
    const { TAGALONG_WHATSAPP_PORT: _p, TAGALONG_BRAIN_ADDR: _a, ...rest } = FULL;
    const config = readConfig(rest);
    expect(config.port).toBe(47322);
    expect(config.brainAddr).toBe('127.0.0.1:47321');
  });
});
