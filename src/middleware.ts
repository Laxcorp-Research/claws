import { withAuth } from "next-auth/middleware"

export default withAuth({
  pages: {
    signIn: "/auth/signin",
  },
})

export const config = {
  matcher: [
    "/my-claws/:path*",
    "/setup/:path*",
    "/builder/:path*",
    "/dashboard/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
  ],
}
