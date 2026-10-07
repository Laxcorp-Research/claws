import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { prisma } from "@/lib/db"

const scryptAsync = promisify(scrypt)
const KEY_LEN = 32

export async function hashOwnerPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex")
  const hash = (await scryptAsync(password, salt, KEY_LEN)) as Buffer
  return `scrypt$${salt}$${hash.toString("hex")}`
}

export async function verifyOwnerPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split("$")
  if (scheme !== "scrypt" || !salt || !hex) return false
  const actual = (await scryptAsync(password, salt, KEY_LEN)) as Buffer
  const expected = Buffer.from(hex, "hex")
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export async function authorizeOwnerCredentials(
  credentials: Record<string, unknown> | undefined,
): Promise<{ id: string; email: string; name: string | null } | null> {
  const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : ""
  const password = typeof credentials?.password === "string" ? credentials.password : ""
  if (!email || !password) return null
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user?.hashedPassword) return null
  const ok = await verifyOwnerPassword(password, user.hashedPassword)
  if (!ok) return null
  return { id: user.id, email: user.email, name: user.name }
}
