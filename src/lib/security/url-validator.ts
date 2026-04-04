const BLOCKED_IP_RANGES = [
  /^127\./, // Loopback
  /^10\./, // Private Class A
  /^172\.(1[6-9]|2\d|3[0-1])\./, // Private Class B
  /^192\.168\./, // Private Class C
  /^169\.254\./, // Link-local / AWS metadata
  /^0\./, // Current network
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // Carrier-grade NAT
]

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]

interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateExternalUrl(urlString: string): ValidationResult {
  if (!urlString || urlString.trim() === "") {
    return { valid: false, error: "URL is required" }
  }

  let parsed: URL
  try {
    parsed = new URL(urlString.trim())
  } catch {
    return { valid: false, error: "Invalid URL format" }
  }

  const allowedProtocols =
    process.env.NODE_ENV === "development" ? ["https:", "http:"] : ["https:"]

  if (!allowedProtocols.includes(parsed.protocol)) {
    return { valid: false, error: "Only HTTPS URLs are allowed" }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { valid: false, error: "This hostname is not allowed" }
  }

  for (const range of BLOCKED_IP_RANGES) {
    if (range.test(hostname)) {
      return {
        valid: false,
        error: "URLs pointing to private or internal networks are not allowed",
      }
    }
  }

  if (process.env.NODE_ENV !== "development") {
    const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
    const ipv6Regex = /^\[?[0-9a-fA-F:]+\]?$/
    if (ipv4Regex.test(hostname) || ipv6Regex.test(hostname)) {
      return {
        valid: false,
        error: "Direct IP addresses are not allowed. Use a domain name.",
      }
    }
  }

  if (!hostname.includes(".") && hostname !== "localhost") {
    return { valid: false, error: "URL must have a valid domain name" }
  }

  return { valid: true }
}
