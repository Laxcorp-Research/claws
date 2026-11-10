import { readFileSync } from "node:fs"

/** Host ./certs, read-only inside app and runtime containers. */
export const EXTRA_CA_DIR = "/usr/local/share/ca-certificates/extra"
export const CA_BUNDLE_PATH = "/certs/bundle.pem"

/**
 * Runs in the container shell before the real process. No pem files: no-op.
 * The bundle is written to a writable path because the cert mount is read-only.
 */
export const CA_BUNDLE_PRELUDE =
  `if ls ${EXTRA_CA_DIR}/*.pem >/dev/null 2>&1; then mkdir -p /certs; cat ${EXTRA_CA_DIR}/*.pem > ${CA_BUNDLE_PATH}; export NODE_EXTRA_CA_CERTS=${CA_BUNDLE_PATH}; fi`

/**
 * mountinfo: fields before " - " include the mount point at index 4.
 * The mount source is the second field after " - ".
 */
export function hostSourceForMount(mountinfo: string, mountPoint: string): string | null {
  for (const raw of mountinfo.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const sep = line.indexOf(" - ")
    if (sep < 0) continue
    const left = line.slice(0, sep).split(" ")
    if (left.length < 5) continue
    let mount = left[4]
    try {
      mount = decodeURIComponent(mount)
    } catch {
      // keep the raw field
    }
    if (mount !== mountPoint) continue
    const right = line.slice(sep + 3).split(" ")
    const source = right[1]
    if (!source || source === "none") return null
    try {
      return decodeURIComponent(source)
    } catch {
      return source
    }
  }
  return null
}

export function readHostCertsSource(mountinfo?: string): string | null {
  let text = mountinfo
  if (text === undefined) {
    try {
      text = readFileSync("/proc/self/mountinfo", "utf8")
    } catch {
      return null
    }
  }
  return hostSourceForMount(text, EXTRA_CA_DIR)
}

export function certsBind(hostSource: string): string {
  return `${hostSource}:${EXTRA_CA_DIR}:ro`
}

/** Prefix a /bin/sh -c command so Node sees the bundle. Leaves other commands alone. */
export function prefixCaBundle(command: string[] | undefined): string[] | undefined {
  if (!command || command[0] !== "/bin/sh" || command[1] !== "-c" || typeof command[2] !== "string") {
    return command
  }
  return ["/bin/sh", "-c", `${CA_BUNDLE_PRELUDE}; ${command[2]}`]
}
