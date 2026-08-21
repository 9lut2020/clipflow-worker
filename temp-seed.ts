import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../../packages/db/src/schema";
import { eq } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config({ path: "./.dev.vars" });

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function seed() {
  const clipId = "e901f7dc-3f9f-4ab3-8dba-9c555465938f";
  
  try {
    console.log("Seeding dummy revisions for clip:", clipId);
    
    // Find a valid user
    const users = await db.query.users.findMany({ limit: 1 });
    const userId = users.length > 0 ? users[0].id : "mock-user-id";

    // Create Revision 1
    const rev1 = await db.insert(schema.revisions).values({
      clipId,
      revisionNo: 1,
      driveUrl: "https://drive.google.com/file/d/mock1",
      submitNote: "ตัดต่อฉบับร่างแรกครับ เรียงเนื้อหาตามสคริปต์เรียบร้อย",
      submittedBy: userId,
    }).returning();

    // Create Review for Revision 1
    await db.insert(schema.reviews).values({
      revisionId: rev1[0].id,
      reviewerId: userId,
      status: "NEEDS_REVISION",
      comment: "ภาพรวมโอเคครับ แต่ช่วงนาที 1:20 เสียง Background Music ดังไปหน่อย กลบเสียงพูดหมดเลย รบกวนลดเสียงลงสัก -5db และขยายเวลาฉากจบอีก 2 วินาทีครับ",
    });

    // Create Revision 2
    const rev2 = await db.insert(schema.revisions).values({
      clipId,
      revisionNo: 2,
      driveUrl: "https://drive.google.com/file/d/mock2",
      submitNote: "ปรับลดเสียงเพลงลง และยืดฉากจบตามที่บรีฟแล้วครับ เช็กได้เลย",
      submittedBy: userId,
    }).returning();

    // Create Review for Revision 2
    await db.insert(schema.reviews).values({
      revisionId: rev2[0].id,
      reviewerId: userId,
      status: "APPROVED",
      comment: "เยี่ยมมากครับ เสียงชัดเจนดี ฉากจบกำลังพอดี นำไป Publish ได้เลยครับ! 🎉",
    });

    // Update Clip
    await db.update(schema.clips).set({
      status: "APPROVED",
      currentRevisionId: rev2[0].id,
      updatedAt: new Date()
    }).where(eq(schema.clips.id, clipId));

    console.log("✅ Seed completed successfully!");
  } catch (error) {
    console.error("Error seeding data:", error);
  }
}

seed();
