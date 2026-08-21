import { prisma } from "@/lib/db"
import { isMarketplacePublishEnabled } from "@/lib/marketplace/feature-flags"
import {
  canDeleteCreatorListing,
  deleteBlockedCopy,
  type ListingTradeCounts,
} from "@/lib/marketplace/creator-listing-lifecycle"
import { log } from "@/lib/logger"

export type ListingActionOk<T> = { ok: true; data: T }
export type ListingActionErr = {
  ok: false
  status: number
  code: string
  message: string
}
export type ListingActionResult<T> = ListingActionOk<T> | ListingActionErr

function err(status: number, code: string, message: string): ListingActionErr {
  return { ok: false, status, code, message }
}

export async function countTemplateTrade(templateId: string): Promise<ListingTradeCounts> {
  const [saleCount, purchaseCount, installCount] = await Promise.all([
    prisma.marketplaceSale.count({ where: { templateId } }),
    prisma.purchase.count({ where: { clawTemplateId: templateId, status: "COMPLETED" } }),
    prisma.templateInstall.count({ where: { templateId } }),
  ])
  return { salesCount: saleCount + purchaseCount, installCount }
}

export async function countSkillTrade(skillId: string): Promise<ListingTradeCounts> {
  const [salesCount, installCount] = await Promise.all([
    prisma.marketplaceSale.count({ where: { skillId } }),
    prisma.skillInstall.count({ where: { skillId } }),
  ])
  return { salesCount, installCount }
}

async function loadOwnedTemplate(slug: string, userId: string) {
  const template = await prisma.clawTemplate.findUnique({
    where: { slug },
    include: { creator: { select: { id: true, userId: true } } },
  })
  if (!template) return err(404, "TEMPLATE_NOT_FOUND", "template not found")
  if (!template.creator || template.creator.userId !== userId) {
    return err(403, "FORBIDDEN", "Only the owner can change this listing")
  }
  if (template.trustTier === "OFFICIAL") {
    return err(403, "FORBIDDEN", "Official listings cannot be changed by creators")
  }
  return { ok: true as const, template }
}

async function loadOwnedSkill(slug: string, userId: string) {
  const skill = await prisma.marketplaceSkill.findUnique({
    where: { slug },
    include: { creator: { select: { id: true, userId: true } } },
  })
  if (!skill) return err(404, "SKILL_NOT_FOUND", "skill not found")
  if (!skill.creator || skill.creator.userId !== userId) {
    return err(403, "FORBIDDEN", "Only the owner can change this listing")
  }
  if (skill.trustTier === "OFFICIAL") {
    return err(403, "FORBIDDEN", "Official listings cannot be changed by creators")
  }
  return { ok: true as const, skill }
}

export async function unpublishTemplate(
  userId: string,
  slug: string,
): Promise<ListingActionResult<{ slug: string; isPublished: false }>> {
  const loaded = await loadOwnedTemplate(slug, userId)
  if (!loaded.ok) return loaded
  if (!loaded.template.isPublished) {
    return err(409, "ALREADY_UNPUBLISHED", "This listing is already off the store")
  }
  await prisma.clawTemplate.update({
    where: { id: loaded.template.id },
    data: { isPublished: false },
  })
  log.marketplaceEvent({
    event: "template_unpublished",
    itemId: loaded.template.id,
    itemType: "template",
    userId,
  })
  return { ok: true, data: { slug: loaded.template.slug, isPublished: false } }
}

export async function unpublishSkill(
  userId: string,
  slug: string,
): Promise<ListingActionResult<{ slug: string; isPublished: false }>> {
  const loaded = await loadOwnedSkill(slug, userId)
  if (!loaded.ok) return loaded
  if (!loaded.skill.isPublished) {
    return err(409, "ALREADY_UNPUBLISHED", "This listing is already off the store")
  }
  await prisma.marketplaceSkill.update({
    where: { id: loaded.skill.id },
    data: { isPublished: false },
  })
  log.marketplaceEvent({
    event: "skill_unpublished",
    itemId: loaded.skill.id,
    itemType: "skill",
    userId,
  })
  return { ok: true, data: { slug: loaded.skill.slug, isPublished: false } }
}

export async function publishAgainTemplate(
  userId: string,
  slug: string,
): Promise<ListingActionResult<{ slug: string; reviewStatus: "PENDING" }>> {
  if (!isMarketplacePublishEnabled()) {
    return err(403, "COMING_SOON", "Template publishing is coming soon")
  }
  const loaded = await loadOwnedTemplate(slug, userId)
  if (!loaded.ok) return loaded
  if (loaded.template.isPublished) {
    return err(409, "STILL_PUBLISHED", "Unpublish before submitting for review again")
  }
  if (loaded.template.reviewStatus === "PENDING") {
    return err(409, "ALREADY_PENDING", "This listing is already in review")
  }
  await prisma.clawTemplate.update({
    where: { id: loaded.template.id },
    data: { reviewStatus: "PENDING", rejectionReason: null },
  })
  log.marketplaceEvent({
    event: "template_publish_again",
    itemId: loaded.template.id,
    itemType: "template",
    userId,
  })
  return { ok: true, data: { slug: loaded.template.slug, reviewStatus: "PENDING" } }
}

export async function publishAgainSkill(
  userId: string,
  slug: string,
): Promise<ListingActionResult<{ slug: string; reviewStatus: "PENDING" }>> {
  if (!isMarketplacePublishEnabled()) {
    return err(403, "COMING_SOON", "Skill publishing is coming soon")
  }
  const loaded = await loadOwnedSkill(slug, userId)
  if (!loaded.ok) return loaded
  if (loaded.skill.isPublished) {
    return err(409, "STILL_PUBLISHED", "Unpublish before submitting for review again")
  }
  if (loaded.skill.reviewStatus === "PENDING") {
    return err(409, "ALREADY_PENDING", "This listing is already in review")
  }
  await prisma.marketplaceSkill.update({
    where: { id: loaded.skill.id },
    data: { reviewStatus: "PENDING", rejectionReason: null },
  })
  log.marketplaceEvent({
    event: "skill_publish_again",
    itemId: loaded.skill.id,
    itemType: "skill",
    userId,
  })
  return { ok: true, data: { slug: loaded.skill.slug, reviewStatus: "PENDING" } }
}

export async function deleteTemplate(
  userId: string,
  slug: string,
): Promise<ListingActionResult<{ slug: string; deleted: true }>> {
  const loaded = await loadOwnedTemplate(slug, userId)
  if (!loaded.ok) return loaded
  const counts = await countTemplateTrade(loaded.template.id)
  if (!canDeleteCreatorListing(counts)) {
    return err(409, "DELETE_BLOCKED", deleteBlockedCopy(counts))
  }
  // Listing row only. Never delete MarketplaceSale / Purchase / Install / Review.
  await prisma.clawTemplate.delete({ where: { id: loaded.template.id } })
  if (loaded.template.creatorId) {
    await prisma.creatorProfile.update({
      where: { id: loaded.template.creatorId },
      data: { totalTemplates: { decrement: 1 } },
    })
  }
  log.marketplaceEvent({
    event: "template_deleted",
    itemId: loaded.template.id,
    itemType: "template",
    userId,
    details: counts,
  })
  return { ok: true, data: { slug: loaded.template.slug, deleted: true } }
}

export async function deleteSkill(
  userId: string,
  slug: string,
): Promise<ListingActionResult<{ slug: string; deleted: true }>> {
  const loaded = await loadOwnedSkill(slug, userId)
  if (!loaded.ok) return loaded
  const counts = await countSkillTrade(loaded.skill.id)
  if (!canDeleteCreatorListing(counts)) {
    return err(409, "DELETE_BLOCKED", deleteBlockedCopy(counts))
  }
  await prisma.marketplaceSkill.delete({ where: { id: loaded.skill.id } })
  if (loaded.skill.creatorId) {
    await prisma.creatorProfile.update({
      where: { id: loaded.skill.creatorId },
      data: { totalSkills: { decrement: 1 } },
    })
  }
  log.marketplaceEvent({
    event: "skill_deleted",
    itemId: loaded.skill.id,
    itemType: "skill",
    userId,
    details: counts,
  })
  return { ok: true, data: { slug: loaded.skill.slug, deleted: true } }
}
