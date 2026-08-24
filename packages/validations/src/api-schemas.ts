import { z } from "zod";

export const ClipSubmitRevisionSchema = z.object({
  driveUrl: z.string().url("Must be a valid URL").optional(),
  submitNote: z.string().optional(),
  submittedBy: z.string().optional(),
});

export const ClipBatchCreateSchema = z.object({
  clips: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1, "Name is required"),
      description: z.string().optional().nullable(),
      platform: z.enum(["TIKTOK", "YOUTUBE", "FB_REEL", "IG_SQUARE", "OTHER"]).optional(),
      episodeNo: z.number().int().positive("Episode number must be positive"),
      ownerId: z.string().optional(),
      createdBy: z.string().optional(),
      deadline: z.string().optional().nullable(),
    })
  ).min(1, "At least one clip is required"),
});

export const ProjectCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  pictureUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")).nullable(),
});

export const ProjectUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  pictureUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")).nullable(),
  isActive: z.boolean().optional(),
});

export const UserSyncSchema = z.object({
  lineUserId: z.string().min(1, "lineUserId is required"),
  displayName: z.string().optional(),
  pictureUrl: z.string().url().optional().or(z.literal("")).nullable(),
  role: z.enum(["USER", "REVIEWER", "ADMIN"]).optional(),
});

export const UserProfileUpdateSchema = z.object({
  displayName: z.string().min(1, "Display name is required").max(100, "Display name is too long"),
});

export const UserRoleUpdateSchema = z.object({
  role: z.enum(["USER", "REVIEWER", "ADMIN"]),
});

export const UserStatusUpdateSchema = z.object({
  isActive: z.boolean(),
});

export const ReviewSubmitSchema = z.object({
  status: z.enum(["APPROVED", "NEEDS_REVISION"]),
  comment: z.string().optional(),
  timecodeSeconds: z.number().optional().nullable(),
  timecodeStr: z.string().optional().nullable(),
  reviewerId: z.string().optional(),
});

export const ClipScheduleSchema = z.object({
  scheduledPublishAt: z.string().optional().nullable(),
});
