import { describe, expect, it } from "vitest"
import {
  CA_BUNDLE_PRELUDE,
  certsBind,
  hostSourceForMount,
  prefixCaBundle,
} from "@/lib/openclaw/corporate-ca"

const MOUNTINFO = [
  "36 35 98:0 /certs /usr/local/share/ca-certificates/extra ro,relatime - ext4 /run/desktop/mnt/host/c/claws/certs rw",
  "37 35 98:0 / / rw - overlay overlay rw",
].join("\n")

describe("corporate CA mount", () => {
  it("reads the host source of the extra CA directory", () => {
    expect(hostSourceForMount(MOUNTINFO, "/usr/local/share/ca-certificates/extra")).toBe(
      "/run/desktop/mnt/host/c/claws/certs",
    )
    expect(certsBind("/run/desktop/mnt/host/c/claws/certs")).toBe(
      "/run/desktop/mnt/host/c/claws/certs:/usr/local/share/ca-certificates/extra:ro",
    )
  })

  it("prefixes the runtime shell so Node trusts the bundle", () => {
    const wrapped = prefixCaBundle(["/bin/sh", "-c", "echo $CLAWS_BOOT_B64 | base64 -d > /tmp/boot.sh && exec sh /tmp/boot.sh"])
    expect(wrapped?.[2].startsWith(CA_BUNDLE_PRELUDE)).toBe(true)
    expect(wrapped?.[2]).toContain("NODE_EXTRA_CA_CERTS=/certs/bundle.pem")
    expect(wrapped?.[2]).toContain("exec sh /tmp/boot.sh")
  })

  it("leaves a non-shell command unchanged", () => {
    expect(prefixCaBundle(["node", "server.js"])).toEqual(["node", "server.js"])
  })
})
