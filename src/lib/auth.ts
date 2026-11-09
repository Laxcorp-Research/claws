import { NextAuthOptions } from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import type { Adapter } from "next-auth/adapters"
import GitHubProvider from "next-auth/providers/github"
import GoogleProvider from "next-auth/providers/google"
import EmailProvider from "next-auth/providers/email"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/db"
import { sendEmail } from "./email/send-email"
import { grantStarterCredits } from "@/lib/credits/grant"
import { requestReconcileForUser } from "@/lib/openclaw/request-reconcile"
import {
  readTosConsentCookieVersion,
  recordConsent,
  recordTosConsentIfMissing,
} from "@/lib/legal/consent-server"
import { authorizeOwnerCredentials } from "@/lib/auth/owner-password"
import { signInMethods } from "@/lib/auth/signin-methods"

function CustomPrismaAdapter(p: typeof prisma): Adapter {
  const base = PrismaAdapter(p) as Adapter;

  function withImage<T extends { avatarUrl: string | null }>(user: T) {
    return { ...user, image: user.avatarUrl } as T & { image: string | null };
  }

  return {
    ...base,
    createUser: async (data: Record<string, unknown>) => {
      const { image, ...rest } = data;
      const user = await p.user.create({
        data: {
          ...rest,
          avatarUrl: (image as string) || null,
        } as Parameters<typeof p.user.create>[0]["data"],
      });
      return withImage(user) as never;
    },
    getUser: async (id: string) => {
      const user = await p.user.findUnique({ where: { id } });
      if (!user) return null;
      return withImage(user) as never;
    },
    getUserByEmail: async (email: string) => {
      const user = await p.user.findUnique({ where: { email } });
      if (!user) return null;
      return withImage(user) as never;
    },
    getUserByAccount: async (providerAccountId: { provider: string; providerAccountId: string }) => {
      const account = await p.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: providerAccountId.provider,
            providerAccountId: providerAccountId.providerAccountId,
          },
        },
        include: { user: true },
      });
      if (!account?.user) return null;
      return withImage(account.user) as never;
    },
    updateUser: async (data: Record<string, unknown> & { id: string }) => {
      const { image, ...rest } = data;
      const updateData: Record<string, unknown> = { ...rest };
      if (image !== undefined) {
        updateData.avatarUrl = image;
        delete updateData.image;
      }
      const user = await p.user.update({
        where: { id: data.id },
        data: updateData as Parameters<typeof p.user.update>[0]["data"],
      });
      return withImage(user) as never;
    },
  };
}

function buildAuthProviders(): NextAuthOptions["providers"] {
  const methods = signInMethods(process.env)
  const providers: NextAuthOptions["providers"] = []
  if (methods.github) {
    providers.push(
      GitHubProvider({
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      }),
    )
  }
  if (methods.google) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
    )
  }
  if (methods.magicLink) {
    providers.push(EmailProvider({
      server: { host: "unused", port: 0, auth: { user: "", pass: "" } },
      from: "Claws <noreply@buildclaws.ai>",
      sendVerificationRequest: async ({ identifier: email, url }) => {
        // RESEND ERROR HONESTY: the old try/catch only saw THROWN errors,
        // but the SDK resolves { error } on failure - NextAuth then told the
        // user "check your email" for a mail that never left. The wrapper
        // checks the error field; a failed send throws so NextAuth surfaces
        // the EmailSignin error instead of a dead-end sent state.
        const result = await sendEmail({
          kind: "magic_link",
          to: email,
          subject: "Sign in to Claws",
          html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="margin:0;padding:0;background-color:#FBFBFB;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid #EFEFEF;border-radius:12px;">
                  <tr>
                    <td style="padding:40px 32px;text-align:center;">
                      <div style="font-size:20px;font-weight:700;color:#0A0A0B;margin-bottom:8px;">Claws</div>
                      <div style="font-size:13px;color:#777777;margin-bottom:32px;">Sign in to your account</div>
                      <a href="${url}" style="display:inline-block;padding:10px 32px;background-color:#0A0A0B;color:#FFFFFF;font-size:13px;font-weight:500;text-decoration:none;border-radius:8px;">
                        Sign in
                      </a>
                      <div style="margin-top:32px;font-size:11px;color:#999999;line-height:1.5;">
                        If you didn't request this email, you can safely ignore it.<br/>
                        This link expires in 24 hours.
                      </div>
                    </td>
                  </tr>
                </table>
              </body>
              </html>
            `,
        });
        if (!result.ok) {
          throw new Error("Failed to send verification email");
        }
      },
    }))
  }
  if (methods.password) {
    providers.push(
      CredentialsProvider({
        name: "Owner password",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        authorize: (credentials) =>
          authorizeOwnerCredentials(credentials as Record<string, unknown> | undefined),
      }),
    )
  }
  return providers
}

export const authOptions: NextAuthOptions = {
  adapter: CustomPrismaAdapter(prisma),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: buildAuthProviders(),
  events: {
    async createUser({ user }) {
      if (user.id) {
        // Signup consent evidence (version + timestamp). The signIn callback
        // below already BLOCKED user creation without the consent cookie; a
        // null version here means the magic link was opened in a different
        // browser than the one that consented at send time - fall back to
        // the current TOS_VERSION and note the cookie absence.
        const consentVersion = await readTosConsentCookieVersion()
        await recordConsent({
          userId: user.id,
          kind: "TOS_PRIVACY",
          version: consentVersion,
          source: "signup",
          metadata: { cookiePresent: consentVersion !== null },
        })
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifiedForCredits: true },
        }).catch(() => {})
        await grantStarterCredits(user.id, "signup").catch((err) => {
          console.error("Failed to grant starter credits:", err)
        })
        // PR-8b/C (E4): reconcile the user's RUNNING containers after the grant.
        // Synchronous (not after()) - this is a NextAuth event callback, not a
        // route handler. At signup there are no running workspaces, so it's a
        // no-op; healWorkspace's ENV_RECONCILE_MODE gate keeps it dormant until
        // the auto_heal flag-flip regardless.
        await requestReconcileForUser(user.id).catch((err) => {
          console.error("Failed to reconcile after grant:", err)
        })
      }
    },
  },
  callbacks: {
    /**
     * Signup consent gate: NEW users (no User row for the email) may not be
     * created without the signup consent cookie the signin page sets when
     * the "I agree to the Terms and Privacy Policy" box is ticked. Existing
     * users always sign in (grandfathered - reported in the legal audit);
     * when they DO arrive with the cookie, the consent is lazily recorded
     * once per version so version bumps re-collect evidence.
     *
     * Fail-closed: a provider that yields no email (e.g. GitHub private
     * email without scope) cannot be proven existing -> treated as signup.
     */
    async signIn({ user, account, email }) {
      if (account?.provider === "credentials") {
        return Boolean(user?.id)
      }
      const userEmail = user?.email ?? null
      const existing = userEmail
        ? await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } })
        : null
      const cookieVersion = await readTosConsentCookieVersion()

      if (!existing) {
        // Magic-link CLICK stage (link may be opened in a different browser
        // that has no cookie): the SEND stage below already gated this
        // address, so the click passes. Everything else - OAuth first
        // sign-in and the magic-link SEND (email.verificationRequest) -
        // blocks without the checkbox cookie.
        const isEmailClickStage =
          account?.provider === "email" && email?.verificationRequest !== true
        if (!cookieVersion && !isEmailClickStage) {
          return "/auth/signin?error=ConsentRequired"
        }
        return true
      }

      if (cookieVersion) {
        await recordTosConsentIfMissing({
          userId: existing.id,
          version: cookieVersion,
          source: "signin-lazy",
        })
      }
      return true
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith(baseUrl)) return url
      if (url.startsWith("/")) return `${baseUrl}${url}`
      return `${baseUrl}/my-claws`
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      // Batch B: expose shown-once flag (User.onboardingCompleted / hasWorkspaces).
      session.onboardingCompleted = token.onboardingCompleted === true
      return session
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.sub = user.id
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { onboardingCompleted: true, _count: { select: { workspaces: true } } },
          })
          const hasWorkspaces = (dbUser?._count?.workspaces ?? 0) > 0
          token.onboardingCompleted = dbUser?.onboardingCompleted || hasWorkspaces
        } catch {
          token.onboardingCompleted = true
        }
      }
      if (trigger === "update" && session?.onboardingCompleted !== undefined) {
        token.onboardingCompleted = session.onboardingCompleted as boolean
      }
      return token
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
}
