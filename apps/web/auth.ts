import NextAuth from "next-auth";
import { authConfig } from "./auth.config.js";
import { getUserById, recordAdminEvent, setEmbeddedWallet, upsertUserFromOAuth } from "./lib/store.js";
import { provisionWallet, walletsEnabled } from "./lib/circle-wallets.js";
import { sendWelcomeEmail } from "./lib/email.js";

/**
 * Full NextAuth instance (Node runtime). Adds the DB-backed jwt callback that
 * upserts the creator/admin record on sign-in and enriches the token with
 * uid/role/handle/walletLinked. Used by the /api/auth route handler and by
 * server components via `auth()`. The Edge middleware uses auth.config.ts
 * instead, so `pg` never reaches the edge bundle.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account, profile, trigger }) {
      // On sign-in `user` is present → create/refresh the DB record.
      if (user?.email) {
        // GitHub OAuth profile carries `login` (the username) — capture it so we
        // can verify ownership of imported GitHub repos.
        const githubUsername =
          account?.provider === "github" ? ((profile?.login as string | undefined) ?? null) : null;
        const { user: dbUser, isNew } = await upsertUserFromOAuth({
          email: user.email,
          name: user.name ?? (profile?.name as string | undefined) ?? null,
          avatar: user.image ?? (profile?.picture as string | undefined) ?? null,
          provider: account?.provider ?? null,
          githubUsername,
        });
        token.uid = dbUser.id;
        token.role = dbUser.role;
        token.handle = dbUser.handle;
        token.walletLinked = !!dbUser.wallet_address;
        if (isNew) {
          await recordAdminEvent({
            eventType: "SIGNUP",
            actorId: dbUser.id,
            metadata: { email: dbUser.email, provider: dbUser.provider, name: dbUser.display_name },
          });
          // Auto-provision a developer-controlled wallet at signup (non-admins
          // only — admins sign with an external wallet). Best-effort: a Circle
          // outage must never block sign-in; the wallet is backfilled later via
          // `npm run db:backfill-wallets` or a visit to /api/wallet/embedded.
          if (dbUser.role !== "admin" && !dbUser.embedded_wallet_id && walletsEnabled()) {
            try {
              const w = await provisionWallet();
              await setEmbeddedWallet(dbUser.id, w.id, w.address);
              token.walletLinked = true;
            } catch (e) {
              console.error("[auth] wallet auto-provision failed:", (e as Error)?.message ?? e);
            }
          }
          try {
            await sendWelcomeEmail({
              name: dbUser.display_name ?? dbUser.name ?? "there",
              email: dbUser.email,
            });
          } catch (e) {
            console.error("[auth] welcome email failed:", (e as Error)?.message ?? e);
          }
        }
      } else if (trigger === "update" && token.uid) {
        // Client called session.update() (e.g. after linking a wallet) — refresh.
        const fresh = await getUserById(token.uid as string);
        if (fresh) {
          token.role = fresh.role;
          token.handle = fresh.handle;
          token.walletLinked = !!fresh.wallet_address;
        }
      }
      return token;
    },
  },
});
