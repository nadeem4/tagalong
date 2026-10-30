/**
 * What Scout never looks at, built in and on for everyone.
 *
 * These sit beside the person's own exclusion list rather than inside it, so clearing that
 * list never takes them away. Settings shows them, read-only, with the reason for each.
 *
 * Matching is by the focused window's process name or title, so a rule only works when the
 * app or the title says what it is. Secrets that slip past (an editor shows `.env` in its
 * title only while that tab is open) are still hidden on the way out by the brain.
 * Contains BLIND_SPOTS, SECRET_FILES and BUILT_IN_EXCLUSIONS.
 */
export interface BlindSpot {
  label: string;
  reason: string;
  /** Matched against the whole process name, case-insensitively, `.exe` or not. */
  processNames: readonly string[];
  /** Anchored, case-insensitive globs over the window title; `*` is the only wildcard. */
  titlePatterns: readonly string[];
  /** File names, `*` the only wildcard, matched against each word of the window title. */
  files: readonly string[];
}

/** Files that hold keys, passwords or tokens. Also kept from the experts, not only from Scout. */
export const SECRET_FILES: readonly string[] = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.pfx',
  '*.p12',
  'id_rsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.htpasswd',
  'credentials.json',
  'kubeconfig',
  '*.tfvars',
  'secrets.*',
  '*.kdbx',
];

export const BLIND_SPOTS: readonly BlindSpot[] = [
  {
    label: 'Password managers',
    reason: 'They show every password you have.',
    processNames: [
      '1Password.exe',
      'Bitwarden.exe',
      'KeePass.exe',
      'KeePassXC.exe',
      'LastPass.exe',
      'Dashlane.exe',
      'Keeper Password Manager.exe',
      'Proton Pass.exe',
      'Enpass.exe',
    ],
    titlePatterns: [
      '*1Password*',
      '*Bitwarden*',
      '*KeePass*',
      '*LastPass*',
      '*Dashlane*',
      '*Keeper Password*',
      '*Proton Pass*',
      '*Enpass*',
    ],
    files: [],
  },
  {
    label: 'Windows sign-in and security prompts',
    reason: 'They ask for your Windows password or show saved credentials.',
    processNames: ['CredentialUIBroker.exe', 'LogonUI.exe', 'consent.exe'],
    titlePatterns: ['*Windows Security*', 'Credential Manager*'],
    files: [],
  },
  {
    label: 'Secret files',
    reason: 'Keys, tokens and passwords, such as .env files, open in any editor.',
    processNames: [],
    titlePatterns: [],
    files: SECRET_FILES,
  },
  {
    label: 'Private browsing',
    reason: 'You opened it so it would not be seen.',
    processNames: [],
    titlePatterns: ['*InPrivate*', '*Incognito*', '*Private Browsing*'],
    files: [],
  },
  {
    label: 'Authenticator apps',
    reason: 'They show your sign-in codes.',
    processNames: ['Authy Desktop.exe', 'WinAuth.exe'],
    titlePatterns: [],
    files: [],
  },
  {
    label: 'Remote desktop',
    reason: 'Another computer, which may not be yours to show.',
    processNames: ['mstsc.exe'],
    titlePatterns: [],
    files: [],
  },
];

/** The blind spots as one exclusion list, in the shape the person's own list has. */
export const BUILT_IN_EXCLUSIONS = {
  processNames: BLIND_SPOTS.flatMap((spot) => spot.processNames),
  titlePatterns: BLIND_SPOTS.flatMap((spot) => spot.titlePatterns),
};
