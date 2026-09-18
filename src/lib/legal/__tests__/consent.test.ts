// Legal constants: canonical buildclaws.ai URLs (sitemap-verified), consent
// version shape, financial-template classification, and copy locks so legal
// wording cannot silently drift.
import { describe, it, expect } from "vitest"
import {
  AUTONOMOUS_S8_RISK_LINE,
  FINANCIAL_ACK_LABEL,
  FINANCIAL_ACK_REQUIRED_CODE,
  FINANCIAL_TEMPLATE_SLUGS,
  LEGAL_URLS,
  SIGNUP_CONSENT_LABEL,
  TERMS_SECTION_8_URL,
  TOS_VERSION,
  isFinancialTemplateSlug,
  parseConsentCookieVersion,
} from "@/lib/legal/consent"
import { REGULATED_TEMPLATE_SLUGS } from "@/lib/openclaw/regulated-threshold-floor"

describe("legal URLs", () => {
  it("all five legal links point at the live buildclaws.ai legal pages", () => {
    expect(LEGAL_URLS.privacy).toBe(
      "https://buildclaws.ai/legal-stjrdjctdfcjtygckghck/privacy-policy",
    )
    expect(LEGAL_URLS.terms).toBe(
      "https://buildclaws.ai/legal-stjrdjctdfcjtygckghck/terms-of-service",
    )
    expect(LEGAL_URLS.cookie).toBe(
      "https://buildclaws.ai/legal-stjrdjctdfcjtygckghck/cookie-policy",
    )
    expect(LEGAL_URLS.aup).toBe(
      "https://buildclaws.ai/legal-stjrdjctdfcjtygckghck/acceptable-use",
    )
    expect(LEGAL_URLS.dataProcessing).toBe(
      "https://buildclaws.ai/legal-stjrdjctdfcjtygckghck/data-processing",
    )
  })

  it("§8 references resolve to the Terms page (Framer page has no heading anchors)", () => {
    expect(TERMS_SECTION_8_URL).toBe(LEGAL_URLS.terms)
  })
})

describe("consent version", () => {
  it("TOS_VERSION tracks the ToS effective date shape (YYYY-MM)", () => {
    expect(TOS_VERSION).toMatch(/^\d{4}-\d{2}$/)
    expect(TOS_VERSION).toBe("2026-08")
  })

  it("cookie parser accepts only plausible versions (nothing else reaches the DB)", () => {
    expect(parseConsentCookieVersion(TOS_VERSION)).toBe(TOS_VERSION)
    expect(parseConsentCookieVersion(" 2026-08 ")).toBe("2026-08")
    expect(parseConsentCookieVersion("true")).toBeNull()
    expect(parseConsentCookieVersion("<script>")).toBeNull()
    expect(parseConsentCookieVersion("")).toBeNull()
    expect(parseConsentCookieVersion(undefined)).toBeNull()
    expect(parseConsentCookieVersion(null)).toBeNull()
  })
})

describe("financial templates (§8 ack gate)", () => {
  it("quant-trader is financial", () => {
    expect(FINANCIAL_TEMPLATE_SLUGS).toContain("quant-trader")
    expect(isFinancialTemplateSlug("quant-trader")).toBe(true)
  })

  it("null/unknown/regulated-but-not-financial slugs are not financial", () => {
    expect(isFinancialTemplateSlug(null)).toBe(false)
    expect(isFinancialTemplateSlug(undefined)).toBe(false)
    expect(isFinancialTemplateSlug("twitter-growth-machine")).toBe(false)
    // Regulated (quality-floor) is a DIFFERENT legal class than financial.
    for (const slug of REGULATED_TEMPLATE_SLUGS) {
      expect(isFinancialTemplateSlug(slug)).toBe(false)
    }
  })
})

describe("copy locks", () => {
  it("signup checkbox copy", () => {
    expect(SIGNUP_CONSENT_LABEL).toBe("I agree to the Terms and Privacy Policy")
  })

  it("financial ack copy names §8", () => {
    expect(FINANCIAL_ACK_LABEL).toBe("I've read the AI & autonomy terms (§8)")
    expect(FINANCIAL_ACK_REQUIRED_CODE).toBe("FINANCIAL_TERMS_ACK_REQUIRED")
  })

  it("autonomy risk line names §8 responsibility", () => {
    expect(AUTONOMOUS_S8_RISK_LINE).toContain("§8")
    expect(AUTONOMOUS_S8_RISK_LINE.toLowerCase()).toContain("your responsibility")
  })
})
