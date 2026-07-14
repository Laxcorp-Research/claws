import { notFound } from "next/navigation"
import { ChatViewportFixture } from "./chat-viewport-fixture"

export default function E2EChatViewportPage() {
  if (process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "true") notFound()
  return <ChatViewportFixture />
}
