import { describe, it, expect } from "vitest"
import { validateExternalUrl } from "../url-validator"

describe("validateExternalUrl", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(validateExternalUrl("https://api.example.com/v1").valid).toBe(true)
    expect(validateExternalUrl("https://hooks.slack.com/services/T00/B00/xxx").valid).toBe(true)
  })

  it("rejects empty URLs", () => {
    expect(validateExternalUrl("").valid).toBe(false)
    expect(validateExternalUrl("  ").valid).toBe(false)
  })

  it("rejects invalid URLs", () => {
    expect(validateExternalUrl("not-a-url").valid).toBe(false)
    expect(validateExternalUrl("ftp://files.example.com").valid).toBe(false)
  })

  it("rejects localhost", () => {
    expect(validateExternalUrl("https://localhost:3000").valid).toBe(false)
    expect(validateExternalUrl("https://localhost/api").valid).toBe(false)
  })

  it("rejects private IP ranges", () => {
    expect(validateExternalUrl("https://127.0.0.1").valid).toBe(false)
    expect(validateExternalUrl("https://10.0.0.1").valid).toBe(false)
    expect(validateExternalUrl("https://192.168.1.1").valid).toBe(false)
    expect(validateExternalUrl("https://172.16.0.1").valid).toBe(false)
  })

  it("rejects AWS metadata endpoint", () => {
    expect(validateExternalUrl("https://169.254.169.254").valid).toBe(false)
  })

  it("rejects cloud metadata hostnames", () => {
    expect(validateExternalUrl("https://metadata.google.internal").valid).toBe(false)
  })

  it("rejects URLs without valid TLD", () => {
    expect(validateExternalUrl("https://intranet").valid).toBe(false)
  })
})
