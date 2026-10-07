import { z } from 'zod';

/** Phase 8. One pet as the roles upgrade left it, for the one-time "roles now" notice. */
export const RolesUpgradeNoticePet = z.object({
  petId: z.string().min(1),
  /** The pet's name when it was upgraded. */
  name: z.string().min(1),
  roleId: z.string().min(1),
  /** Its persona was the user's own words, so it now lives on as the pet's notes. */
  keptNotes: z.boolean(),
  /** A pet the user created, not one of the default crew. */
  madeByYou: z.boolean(),
});
export type RolesUpgradeNoticePet = z.infer<typeof RolesUpgradeNoticePet>;

/**
 * Phase 8. What the upgrade to roles did to an existing install, shown once. A fresh
 * install never has one.
 */
export const RolesUpgradeNotice = z.object({ pets: z.array(RolesUpgradeNoticePet) });
export type RolesUpgradeNotice = z.infer<typeof RolesUpgradeNotice>;

/** The notices a host can dismiss. */
export const NoticeName = z.enum(['rolesUpgrade']);
export type NoticeName = z.infer<typeof NoticeName>;

/** Phase 8. The roles notice while it is unseen; `null` once dismissed, or when there is none. */
export const NoticesRolesUpgradeParams = z.object({});
export const NoticesRolesUpgradeResult = z.object({ notice: RolesUpgradeNotice.nullable() });

/** Phase 8. Marks a notice seen, so no host shows it again. */
export const NoticesDismissParams = z.object({ notice: NoticeName });
export const NoticesDismissResult = z.object({ dismissed: z.boolean() });
