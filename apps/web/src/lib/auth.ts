/* eslint-disable no-console */
// Console logging is intentional in this file to avoid importing logger/mailer
// which would cause webpack bundling issues in middleware (Edge Runtime)
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization, openAPI, admin } from 'better-auth/plugins';
import { magicLink } from 'better-auth/plugins/magic-link';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import {
  DEMO_ACCOUNT_LOCKED_MESSAGE,
  DEMO_ACCOUNT_LOCKED_PATHS,
  isDemoAccountLockedRequest,
} from '@/lib/demo-account-lock';
import { pendingMagicLinkContext } from './magic-link-context';
import { nextCookies } from 'better-auth/next-js';
import { stripe as stripePlugin } from '@better-auth/stripe';
import {
  orgAccessControl,
  orgRoles,
  platformRoles,
} from './auth-access-control';
import Stripe from 'stripe';
import crypto from 'node:crypto';
import db from '@ragenai/prisma-client';
import {
  hasPendingInvitation,
  isRegistrationOpen,
  isUnclaimedEmptyInstall,
} from './registration';
import { createOrganizationWithDefaultProjectCommand as createOrganizationWithDefaultProject } from '@/features/organizations/services/commands/create-organization-command';
import { applyDefaultLimitsToOrg } from '@/features/organizations/services/organization-settings';
import { ensureLiteLLMTeamCommand } from '@/features/organizations/services/commands/litellm-team-command';
import { provisionLiteLLMForTeamCommand } from '@/features/teams/services/commands/provision-litellm-team-command';
import { updateLiteLLMForTeamCommand } from '@/features/teams/services/commands/update-litellm-team-command';
import { deprovisionLiteLLMForTeamCommand } from '@/features/teams/services/commands/deprovision-litellm-team-command';
import {
  syncLiteLLMTeamMemberAddCommand,
  syncLiteLLMTeamMemberRemoveCommand,
} from '@/features/teams/services/commands/sync-litellm-team-member-command';
import { trackAudit } from '@/features/audit-logs/services/commands/create-audit-log-command';
import { eventBus } from '@/libs/events';
import { isTestTargetEnv } from '@/libs/utils/env';
import { resolveDefaultVectorStore } from '@ragenai/rag-core';

const stripeClient =
  process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

// Email functions - using console.log to avoid importing logger/mailer in middleware
// TODO: Move email sending to background jobs instead of auth hooks
async function sendPasswordResetEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}) {
  try {
    const { sendPasswordResetEmailViaMailer } =
      await import('@/app/emails/services/mailer');
    const result = await sendPasswordResetEmailViaMailer({ to, resetUrl });
    if ('error' in result) {
      console.error('[AUTH] Failed to send password reset email', {
        to,
        error: result.error,
      });
    } else {
      console.log('[AUTH] Password reset email sent', { to });
    }
  } catch (error) {
    console.error('[AUTH] Failed to send password reset email', { to, error });
  }
}

async function sendVerificationEmailViaMailer({
  to,
  verificationUrl,
}: {
  to: string;
  verificationUrl: string;
}) {
  try {
    const { sendVerificationEmail } =
      await import('@/app/emails/services/mailer');
    const result = await sendVerificationEmail({
      to,
      verificationUrl,
    });
    if ('error' in result) {
      console.error('[AUTH] Failed to send verification email', {
        to,
        error: result.error,
      });
    } else {
      console.log('[AUTH] Verification email sent', { to });
    }
  } catch (error) {
    console.error('[AUTH] Failed to send verification email', { to, error });
  }
}

async function sendOrganizationInvite(data: any) {
  // Import mailer dynamically to avoid Edge Runtime issues
  const { sendInvitationEmail } = await import('@/app/emails/services/mailer');

  try {
    await sendInvitationEmail({
      to: data.email,
      organizationName: data.organizationName,
      inviterName: data.inviterName,
      role: data.role,
      invitationId: data.id,
      expiresAt: data.expiresAt,
    });
    console.log('[AUTH] Invitation email sent', { email: data.email });
  } catch (error) {
    console.error('[AUTH] Failed to send invitation email', { error, data });
    // Don't throw - invitation was created successfully
  }
}

/**
 * Sends the Better Auth magic-link URL via our invitation email template.
 * The link, when clicked, signs the user in (creating the account on first
 * click if needed) and redirects to `callbackURL` / `newUserCallbackURL`.
 */
async function handleSendMagicLink({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  const key = email.toLowerCase();
  const context = pendingMagicLinkContext.get(key);
  try {
    if (!context) {
      console.warn('[AUTH] sendMagicLink without context — skipping email', {
        email,
      });
      return;
    }
    const { sendMagicLinkInvitationEmail } =
      await import('@/app/emails/services/mailer');
    const result = await sendMagicLinkInvitationEmail({
      to: email,
      magicLinkUrl: url,
      organizationName: context.organizationName,
      inviterName: context.inviterName,
      role: context.role,
    });
    if ('error' in result) {
      console.error('[AUTH] Failed to send magic-link invitation email', {
        email,
        error: result.error,
      });
      // Surface the failure so callers (e.g. inviteMember) can roll the
      // invitation back instead of silently swallowing a missed email.
      throw new Error(result.error);
    }
    console.log('[AUTH] Magic-link invitation email sent', { email });
  } finally {
    pendingMagicLinkContext.delete(key);
  }
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  trustedOrigins: [
    'http://localhost:3000',
    ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
  ],

  advanced: {
    cookiePrefix: 'better-auth',
  },

  database: prismaAdapter(db, {
    provider: 'postgresql',
  }),

  // No social providers. Sign-in with Google is an enterprise-edition feature;
  // the open edition is email + password and magic link. apps/admin keeps its
  // own Google provider — it is the internal operator panel, gated to a single
  // email domain, and has no other way in.

  emailAndPassword: {
    enabled: true,
    requireEmailVerification:
      process.env.NODE_ENV === 'production' ||
      process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
    minPasswordLength: 8,
    maxPasswordLength: 128,
    async sendResetPassword({ user, url }) {
      await sendPasswordResetEmail({ to: user.email, resetUrl: url });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    async sendVerificationEmail({ user, url }) {
      await sendVerificationEmailViaMailer({
        to: user.email,
        verificationUrl: url,
      });
    },
    async afterEmailVerification(user) {
      await eventBus.emit('user.emailVerified', {
        userId: user.id,
        email: user.email,
        name: user.name ?? null,
      });
    },
  },

  plugins: [
    openAPI(),
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
      // Withholds `user: ["impersonate"]`, which is what the plugin's
      // impersonate route authorizes on. See `platformAdminAc`.
      roles: platformRoles,
    }),
    organization({
      ac: orgAccessControl,
      roles: orgRoles,
      teams: {
        enabled: true,
      },
      async sendInvitationEmail(data) {
        await sendOrganizationInvite(data);
      },
      organizationHooks: {
        afterCreateTeam: async ({ team }) => {
          try {
            await provisionLiteLLMForTeamCommand({ teamId: team.id });
          } catch (error) {
            console.error('[AUTH] Failed to provision LiteLLM team', {
              teamId: team.id,
              error,
            });
          }
          trackAudit({
            action: 'team.created',
            entityType: 'Team',
            entityId: team.id,
            newData: { name: team.name, organizationId: team.organizationId },
          });
        },
        afterUpdateTeam: async ({ team }) => {
          if (!team) {
            return;
          }
          try {
            await updateLiteLLMForTeamCommand({ teamId: team.id });
          } catch (error) {
            console.error('[AUTH] Failed to sync LiteLLM team update', {
              teamId: team.id,
              error,
            });
          }
        },
        beforeDeleteTeam: async ({ team }) => {
          // The auto-created "General" team is structural — every org keeps
          // one. Refuse deletion at the API layer so any UI path is blocked.
          if (team.id.endsWith('-general')) {
            throw new Error('Default team cannot be deleted');
          }
          try {
            await deprovisionLiteLLMForTeamCommand({
              teamId: team.id,
              litellmTeamId: team.litellmTeamId ?? null,
              litellmKeyToken: team.litellmKeyToken ?? null,
            });
          } catch (error) {
            console.error('[AUTH] Failed to deprovision LiteLLM team', {
              teamId: team.id,
              error,
            });
          }
          trackAudit({
            action: 'team.deleted',
            entityType: 'Team',
            entityId: team.id,
            oldData: { name: team.name, organizationId: team.organizationId },
          });
        },
        afterAddTeamMember: async ({ teamMember, team, user }) => {
          try {
            await syncLiteLLMTeamMemberAddCommand({
              teamId: teamMember.teamId,
              organizationId: team.organizationId,
              userId: teamMember.userId,
              userEmail: user?.email,
            });
          } catch (error) {
            console.error('[AUTH] Failed to sync LiteLLM team member add', {
              teamId: teamMember.teamId,
              userId: teamMember.userId,
              error,
            });
          }
          trackAudit({
            action: 'team.member_added',
            entityType: 'Team',
            entityId: teamMember.teamId,
            newData: { userId: teamMember.userId, email: user?.email ?? null },
          });
        },
        afterRemoveTeamMember: async ({ teamMember, team, user }) => {
          try {
            await syncLiteLLMTeamMemberRemoveCommand({
              teamId: teamMember.teamId,
              organizationId: team.organizationId,
              userId: teamMember.userId,
              userEmail: user?.email,
            });
          } catch (error) {
            console.error('[AUTH] Failed to sync LiteLLM team member remove', {
              teamId: teamMember.teamId,
              userId: teamMember.userId,
              error,
            });
          }
          trackAudit({
            action: 'team.member_removed',
            entityType: 'Team',
            entityId: teamMember.teamId,
            oldData: { userId: teamMember.userId, email: user?.email ?? null },
          });
        },
      },
    }),
    magicLink({
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      disableSignUp: false,
      sendMagicLink: handleSendMagicLink,
    }),
    ...(stripeClient
      ? [
          stripePlugin({
            stripeClient,
            stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
            createCustomerOnSignUp: true,
            subscription: {
              enabled: true,
              plans: async () => {
                const plans = await db.subscriptionPlan.findMany({
                  where: { status: 'ACTIVE' },
                });
                return plans.map((plan) => ({
                  name: plan.name,
                  priceId: plan.priceId,
                  limits: plan.limits as Record<string, number>,
                  freeTrial: { days: 14 },
                }));
              },
            },
            onCustomerCreate: async ({ stripeCustomer, user }) => {
              console.log('[AUTH:Stripe] Customer created', {
                customerId: stripeCustomer.id,
                userId: user.id,
              });
            },
          }),
        ]
      : []),
    nextCookies(),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },

  /**
   * Better Auth rate-limits itself at 100 requests per 10 seconds per IP, and
   * turns that on whenever `NODE_ENV === 'production'` — which the E2E suite
   * is, because it drives a production build rather than the dev server.
   *
   * The whole suite is one IP making one request after another as fast as
   * Playwright can drive it, and every authenticated page load costs at least
   * one `/api/auth/get-session`. Around the hundredth in a window the endpoint
   * starts answering 429, the client reads that as "not signed in", and
   * `PanelLayoutWrapper` sends the page to /sign-in. Then the window rolls and
   * it works again.
   *
   * That is what made `p1-31 › members tab shows current user as owner` fail
   * on `main` while the test either side of it passed on the same route: a
   * three-or-four-test hole that moves depending on how the run is paced, and
   * looks exactly like an intermittent auth regression. `reLogin()` in
   * `e2e/helpers.ts` is the workaround the later specs grew for it — it waits
   * and signs in again, which is mostly just waiting out the window.
   *
   * Off for `TARGET_ENV=test` only. Production keeps the limiter: it is there
   * to make credential stuffing expensive, and a test environment has no
   * credentials worth stuffing.
   */
  rateLimit: {
    enabled: !isTestTargetEnv,
  },

  user: {
    additionalFields: {
      onboardingComplete: {
        type: 'boolean',
        defaultValue: false,
      },
      role: {
        type: 'string',
        defaultValue: 'user',
      },
    },
  },

  /**
   * The shared demo account is frozen at the endpoint, not only in the UI.
   *
   * `user/profile` and `settings/account` disable their forms for it, but the
   * routes those forms call are public Better Auth endpoints, and the sessions
   * page calls `authClient.revokeSessions()` from the browser directly. One
   * refusal here covers every caller — the forms, the server actions that go
   * through `auth.api`, and a visitor with the network tab open. The list of
   * paths and the predicate live in `lib/demo-account-lock.ts`, where they
   * can be unit-tested without standing up Better Auth.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (
        !(DEMO_ACCOUNT_LOCKED_PATHS as readonly string[]).includes(ctx.path)
      ) {
        return;
      }

      const session = await getSessionFromCtx(ctx);
      if (isDemoAccountLockedRequest(ctx.path, session?.user.email)) {
        throw new APIError('FORBIDDEN', {
          message: DEMO_ACCOUNT_LOCKED_MESSAGE,
        });
      }
    }),
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * The one place registration can be closed.
         *
         * Both doors into this application have to create a user row: the
         * email-and-password sign-up form, and `magicLink`, which is
         * configured with `disableSignUp: false` and so creates an account
         * for a link requested at an unknown address. Gating the form alone
         * would have left that one open behind a UI that said closed, and
         * any provider added later would need its own flag. Here, they all
         * pass through the same check.
         *
         * Throwing rather than returning `false`: Better Auth reads `false`
         * as "skip the create" and hands the caller a null user, which
         * surfaces as an opaque failure. An `APIError` reaches the client as
         * a 403 that says what happened.
         */
        before: async (user) => {
          if (await isRegistrationOpen()) {
            return;
          }

          // An invitation is the administrator letting someone in by name.
          // Closing registration stops strangers, not a colleague accepting
          // an invitation that was deliberately sent.
          if (await hasPendingInvitation(user.email)) {
            return;
          }

          // The first-run setup screen. A fresh install has registration
          // closed and nobody who could open it, so the one account
          // /initial-account exists to create has to pass through here or
          // the install is a dead end.
          if (await isUnclaimedEmptyInstall()) {
            return;
          }

          throw new APIError('FORBIDDEN', {
            message:
              'Registration is disabled on this installation. Ask an administrator for an invitation.',
          });
        },
        after: async (user) => {
          try {
            // Backfill `name` for users that arrived via magic-link sign-up
            // (Better Auth's flow doesn't ask for one). Use the email local
            // part as a sensible default; users can edit it later.
            if (!user.name || user.name.trim() === '') {
              const derivedName = user.email.split('@')[0];
              await db.user
                .update({ where: { id: user.id }, data: { name: derivedName } })
                .catch((err) =>
                  console.error('[AUTH] Failed to backfill user name', {
                    userId: user.id,
                    error: err,
                  }),
                );
              user.name = derivedName;
            }

            // Users created via invitation acceptance should join the inviting
            // org, not get a brand-new personal one. Detect a pending
            // invitation for this email and skip personal-org provisioning —
            // the acceptInvitation action will add them as a Member.
            const pendingInvitation = await db.invitation.findFirst({
              where: {
                email: user.email.toLowerCase(),
                status: 'pending',
                expiresAt: { gt: new Date() },
              },
              select: { id: true, organizationId: true },
            });
            if (pendingInvitation) {
              console.log(
                '[AUTH] Skipping personal-org creation for invited user',
                {
                  userId: user.id,
                  invitationId: pendingInvitation.id,
                  organizationId: pendingInvitation.organizationId,
                },
              );
              return;
            }

            const firstName = user.name || 'User';
            const organizationName = `${firstName}'s Organization`;

            console.log('[AUTH] Creating organization for new user', {
              userId: user.id,
            });

            // Create organization directly via Prisma (auth.api requires session context
            // which is not available during OAuth callback hooks)
            const orgId = crypto.randomUUID();
            const memberId = crypto.randomUUID();

            await db.organization.create({
              data: {
                id: orgId,
                name: organizationName,
                slug: `${user.id}-org`,
              },
            });

            await db.member.create({
              data: {
                id: memberId,
                organizationId: orgId,
                userId: user.id,
                role: 'owner',
              },
            });

            console.log('[AUTH] Organization created and user added as owner', {
              userId: user.id,
              orgId,
            });

            // Create default project and apply default limits
            await createOrganizationWithDefaultProject(orgId, user.id);
            await applyDefaultLimitsToOrg(orgId);

            // Create LiteLLM team + virtual key for this organization
            try {
              await ensureLiteLLMTeamCommand(orgId, organizationName);
            } catch (litellmError) {
              console.error(
                '[AUTH] Failed to create LiteLLM team (will retry later)',
                { orgId, error: litellmError },
              );
            }

            // Default Better-Auth Team. Mirrors backfill-teams-for-orgs.ts so
            // new signups end up in the same shape as backfilled orgs:
            // resolveLiteLLMKeyQuery prefers the team-level key and only
            // falls back to the org-level one when no team membership
            // resolves. Stable team id makes a partial second run a no-op.
            try {
              const defaultTeamId = `${orgId}-general`;

              await db.team.upsert({
                where: { id: defaultTeamId },
                update: {},
                create: {
                  id: defaultTeamId,
                  name: 'General',
                  organizationId: orgId,
                },
              });

              const existingMembership = await db.teamMember.findFirst({
                where: { teamId: defaultTeamId, userId: user.id },
                select: { id: true },
              });
              if (!existingMembership) {
                await db.teamMember.create({
                  data: {
                    id: crypto.randomUUID(),
                    teamId: defaultTeamId,
                    userId: user.id,
                  },
                });
              }

              await provisionLiteLLMForTeamCommand({ teamId: defaultTeamId });

              // Direct db.teamMember.create above bypasses Better Auth's
              // afterAddTeamMember hook, so mirror what that hook would do.
              // Order matters: the sync looks up team.litellmTeamId, which
              // is only populated by provisionLiteLLMForTeamCommand above.
              try {
                await syncLiteLLMTeamMemberAddCommand({
                  teamId: defaultTeamId,
                  organizationId: orgId,
                  userId: user.id,
                  userEmail: user.email,
                });
              } catch (memberSyncError) {
                console.error(
                  '[AUTH] Failed to sync LiteLLM member add for default team',
                  {
                    orgId,
                    userId: user.id,
                    error: memberSyncError,
                  },
                );
              }
            } catch (teamError) {
              console.error(
                '[AUTH] Failed to provision default Better-Auth team',
                { orgId, userId: user.id, error: teamError },
              );
            }

            // Only backends the ingest worker actually writes to are accepted.
            const defaultVectorStore = resolveDefaultVectorStore();
            await db.organization.update({
              where: { id: orgId },
              data: {
                vectorStore: defaultVectorStore,
                metadata: {
                  vector_store: defaultVectorStore,
                },
              },
            });

            // Stripe customer + trial subscription handled by Better Auth stripe plugin
            console.log('[AUTH] Stripe customer creation handled by plugin');

            // Welcome email and newsletter signup are sent from
            // emailVerification.afterEmailVerification — not here —
            // so they only go out after the user actually verifies their email.
          } catch (error) {
            console.error('[AUTH] Error in user.created hook', {
              userId: user.id,
              error,
            });
            // Don't throw - allow user creation to succeed even if post-creation steps fail
          }
        },
      },
    },
  },

  // Subscription lifecycle managed by Better Auth stripe plugin
});

export type Session = typeof auth.$Infer.Session;
