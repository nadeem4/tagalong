/**
 * The bridge's settings, read once from the environment the brain's supervisor builds for it.
 * It never reads .env: the brain owns the secrets and passes only what the bridge needs.
 */

export interface WhatsAppConfig {
  brainAddr: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  phoneNumberId: string;
  allowedNumber: string;
  port: number;
}

const DEFAULT_PORT = 47322;
const DEFAULT_BRAIN_ADDR = '127.0.0.1:47321';

const REQUIRED = {
  accessToken: 'TAGALONG_WHATSAPP_ACCESS_TOKEN',
  appSecret: 'TAGALONG_WHATSAPP_APP_SECRET',
  verifyToken: 'TAGALONG_WHATSAPP_VERIFY_TOKEN',
  phoneNumberId: 'TAGALONG_WHATSAPP_PHONE_NUMBER_ID',
  allowedNumber: 'TAGALONG_WHATSAPP_ALLOWED_NUMBER',
} as const;

export function readConfig(env: NodeJS.ProcessEnv): WhatsAppConfig {
  const missing = Object.values(REQUIRED).filter((name) => !env[name]);
  if (missing.length > 0) {
    // Names only: the values are secrets and this message is printed.
    throw new Error(`WhatsApp is not set up: missing ${missing.join(', ')}`);
  }
  const value = (name: (typeof REQUIRED)[keyof typeof REQUIRED]): string => env[name] ?? '';
  const port = Number(env.TAGALONG_WHATSAPP_PORT);
  return {
    brainAddr: env.TAGALONG_BRAIN_ADDR || DEFAULT_BRAIN_ADDR,
    accessToken: value(REQUIRED.accessToken),
    appSecret: value(REQUIRED.appSecret),
    verifyToken: value(REQUIRED.verifyToken),
    phoneNumberId: value(REQUIRED.phoneNumberId),
    allowedNumber: value(REQUIRED.allowedNumber),
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
  };
}
