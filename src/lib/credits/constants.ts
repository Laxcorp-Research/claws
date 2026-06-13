/**
 * Single source of truth for the one-time Claws Starter Credit amount.
 *
 * Units: integer CENTS. 5000 cents = $50.00. The product decision is a $50
 * one-time signup credit, Anthropic API only. Every site that grants, defaults,
 * or displays the starter amount MUST source it from here (or read the user's
 * stored `CreditAccount.initialGrantCents` for already-granted accounts) so the
 * value can never drift across grant logic, schema defaults, UI copy, and email.
 *
 * NOTE: this is the GRANT amount only. The WIRE-TEST staging fixture
 * (`scripts/reprovision-wire-test.ts`, 500c) is a deliberately separate test
 * value and is intentionally NOT derived from this constant.
 */
export const STARTER_CREDIT_CENTS = 5000

/** Format an integer-cents amount as a `$X.XX` dollar string. */
export function formatCreditDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
