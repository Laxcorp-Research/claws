export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export async function generateUniqueSlug(
  name: string,
  model: { findUnique: (args: { where: { slug: string } }) => Promise<unknown> }
): Promise<string> {
  const baseSlug = generateSlug(name)
  let slug = baseSlug
  let counter = 1

  while (await model.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${counter}`
    counter++
    if (counter > 100) {
      slug = `${baseSlug}-${Date.now()}`
      break
    }
  }

  return slug
}
