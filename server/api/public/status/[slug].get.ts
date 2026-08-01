import { z } from 'zod'
import { getPublicStatusBySlug } from '../../../services/public-status'
import { AppError, defineApiHandler } from '../../../utils/errors'

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)

export default defineApiHandler(async (event) => {
  const parsed = slugSchema.safeParse(getRouterParam(event, 'slug'))
  if (!parsed.success) {
    throw new AppError(404, 'NOT_FOUND', 'Status page not found')
  }

  const page = await getPublicStatusBySlug(parsed.data)
  return { page }
})
