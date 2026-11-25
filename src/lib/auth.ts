import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { rateLimiter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        // Rate limit: max 5 login attempts per 60 seconds per email
        const rateCheck = rateLimiter.check(`login:${email.toLowerCase()}`, 5, 60);
        if (!rateCheck.success) {
          logger.warn("Login rate limit exceeded", { email: email.toLowerCase() });
          throw new Error("Too many login attempts. Please wait 1 minute before trying again.");
        }

        // Single-owner: only the configured owner email can log in
        const ownerEmail = process.env.DRIVE_OWNER_EMAIL;
        if (!ownerEmail || email !== ownerEmail) {
          logger.warn("Unauthorized login attempt for unconfigured email", { email });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          logger.warn("Login attempt for non-existent owner account", { email });
          return null;
        }

        const passwordMatch = await compare(password, user.hashedPassword);
        if (!passwordMatch) {
          logger.warn("Invalid password attempt for owner account", { email });
          return null;
        }

        // Reset rate limiter on successful authentication
        rateLimiter.reset(`login:${email.toLowerCase()}`);
        logger.info("Owner authenticated successfully", { email, userId: user.id });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
