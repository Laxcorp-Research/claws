import { Suspense } from "react"
import { SignInForm } from "@/app/auth/signin/sign-in-form"
import { signInMethods } from "@/lib/auth/signin-methods"

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm methods={signInMethods(process.env)} />
    </Suspense>
  )
}
