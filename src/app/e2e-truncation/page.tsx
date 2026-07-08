import { notFound } from "next/navigation"
import { TruncationFixture } from "./truncation-fixture"

export default function E2ETruncationPage() {
  if (process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "true") notFound()
  return <TruncationFixture />
}

