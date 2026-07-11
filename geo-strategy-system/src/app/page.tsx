import BrandHome from "@/components/brand/brand-home"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function HomePage() {
  const user = await getCurrentUser()

  return (
    <BrandHome
      user={user ? { name: user.name, role: user.role } : null}
    />
  )
}
