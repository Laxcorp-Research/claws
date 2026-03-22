import { NextAuthOptions } from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import type { Adapter } from "next-auth/adapters"
import GitHubProvider from "next-auth/providers/github"
import GoogleProvider from "next-auth/providers/google"
import { prisma } from "@/lib/db"

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

export const authOptions: NextAuthOptions = {
  adapter: CustomPrismaAdapter(prisma),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      return session
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id
      }
      return token
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
}
