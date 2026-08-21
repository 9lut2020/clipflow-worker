import { sendLinePushFlexMessage, sendLinePushMessage } from "./line.client";
/**
 * Service for sending LINE Push Notifications via LINE Messaging API
 * Specifically configured with Flex Card Message UI for Editor (User) notifications
 */

/**
 * Send LINE Flex Card Push Message with fallback text
 */
// ─── 0. System Test Notification (ClipFlow Test Flex Card) ──────────────────────
export async function notifyTestClipflowFlexCard({
  toLineUserId,
  channelAccessToken,
}: {
  toLineUserId: string;
  channelAccessToken?: string;
}) {
  const timeStr = new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
  });
  const baseUrl = process.env.NEXTAUTH_URL || "https://clipflow.app";

  const flexContents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#2563EB",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "🧪 CLIPFLOW TEST NOTIFICATION",
          weight: "bold",
          color: "#93C5FD",
          size: "xs",
          wrap: true,
        },
        {
          type: "text",
          text: "ทดสอบการแจ้งเตือน ClipFlow",
          weight: "bold",
          color: "#FFFFFF",
          size: "xl",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "📢 ข้อความทดสอบการเชื่อมต่อระบบ Flex Card",
          weight: "bold",
          size: "sm",
          color: "#1E293B",
          wrap: true,
        },
        {
          type: "text",
          text: "ระบบแจ้งเตือน ClipFlow สามารถส่งสัญญาณและ Flex Card เข้าสู่บัญชี LINE ของคุณได้สมบูรณ์แล้ว!",
          size: "xs",
          color: "#64748B",
          wrap: true,
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "🎬 ระบบ:",
                  color: "#64748B",
                  size: "xs",
                  flex: 2,
                  wrap: true,
                },
                {
                  type: "text",
                  text: "ClipFlow Video Automation",
                  weight: "bold",
                  color: "#0F172A",
                  size: "xs",
                  flex: 5,
                  wrap: true,
                },
              ],
            },
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "🟢 สถานะ:",
                  color: "#64748B",
                  size: "xs",
                  flex: 2,
                  wrap: true,
                },
                {
                  type: "text",
                  text: "ปกติ (Connected & Active)",
                  weight: "bold",
                  color: "#059669",
                  size: "xs",
                  flex: 5,
                  wrap: true,
                },
              ],
            },
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "⏰ เวลาที่ทดสอบ:",
                  color: "#64748B",
                  size: "xs",
                  flex: 2,
                  wrap: true,
                },
                {
                  type: "text",
                  text: `${timeStr} น.`,
                  weight: "bold",
                  color: "#0F172A",
                  size: "xs",
                  flex: 5,
                  wrap: true,
                },
              ],
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#2563EB",
          height: "sm",
          action: {
            type: "uri",
            label: "เปิดดูระบบ ClipFlow 🚀",
            uri: baseUrl,
          },
        },
      ],
    },
  };

  const fallbackText = `🧪 [ClipFlow] ทดสอบการแจ้งเตือนสำเร็จ!\n----------------------------------------\n🎬 ระบบ: ClipFlow Video Automation\n🟢 สถานะ: ปกติ (Connected)\n⏰ เวลาที่ทดสอบ: ${timeStr} น.\n----------------------------------------\nเปิดดูระบบ: ${baseUrl}`;

  return sendLinePushFlexMessage({
    toLineUserId,
    altText: "🧪 ทดสอบการแจ้งเตือน ClipFlow (Flex Card)",
    flexContents,
    fallbackText,
    channelAccessToken,
  });
}

// ─── 1. Login Success Notification (Editor Flex Card) ─────────────────────────
export async function notifyLoginSuccess({
  toLineUserId,
  displayName,
  channelAccessToken,
}: {
  toLineUserId: string;
  displayName: string;
  channelAccessToken?: string;
}) {
  const timeStr = new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
  });
  const baseUrl = process.env.NEXTAUTH_URL || "https://clipflow.app";

  const flexContents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#1E40AF",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "🎉 CLIPFLOW By Tmyda",
          weight: "bold",
          color: "#93C5FD",
          size: "xs",
          wrap: true,
        },
        {
          type: "text",
          text: "เข้าสู่ระบบสำเร็จ!",
          weight: "bold",
          color: "#FFFFFF",
          size: "xl",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: `สลาม👋 คุณ ${displayName}`,
          weight: "bold",
          size: "md",
          color: "#1E293B",
          wrap: true,
        },
        {
          type: "box",
          layout: "vertical",
          margin: "md",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "👤 บทบาท:",
                  color: "#64748B",
                  size: "xs",
                  flex: 2,
                  wrap: true,
                },
                {
                  type: "text",
                  text: "Editor",
                  weight: "bold",
                  color: "#0F172A",
                  size: "xs",
                  flex: 5,
                  wrap: true,
                },
              ],
            },
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "⏰ เวลาเข้าใช้งาน:",
                  color: "#64748B",
                  size: "xs",
                  flex: 2,
                  wrap: true,
                },
                {
                  type: "text",
                  text: `${timeStr} น.`,
                  weight: "bold",
                  color: "#0F172A",
                  size: "xs",
                  flex: 5,
                  wrap: true,
                },
              ],
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#2563EB",
          height: "sm",
          action: {
            type: "uri",
            label: "เปิดดูหน้างานของฉัน 🚀",
            uri: `${baseUrl}/tasks`,
          },
        },
      ],
    },
  };

  const fallbackText = `🎉 [ClipFlow] เข้าสู่ระบบสำเร็จ!\n----------------------------------------\n👤 สวัสดีคุณ ${displayName} (Editor)\n⏰ เวลาเข้าใช้งาน: ${timeStr}\n----------------------------------------\nเปิดดูงานของฉัน: ${baseUrl}/tasks`;

  return sendLinePushFlexMessage({
    toLineUserId,
    altText: "🎉 เข้าสู่ระบบสำเร็จ - ClipFlow",
    flexContents,
    fallbackText,
    channelAccessToken,
  });
}

// ─── 2. Needs Revision Notification (Editor Flex Card) ──────────────────────
export async function notifyNeedsRevision({
  toLineUserId,
  clipName,
  projectName,
  reviewerName,
  comment,
  clipId,
  channelAccessToken,
}: {
  toLineUserId: string;
  clipName: string;
  projectName?: string;
  reviewerName?: string;
  comment?: string;
  clipId: string;
  channelAccessToken?: string;
}) {
  const baseUrl = process.env.NEXTAUTH_URL || "https://clipflow.app";
  const clipUrl = `${baseUrl}/clips/${clipId}`;

  const flexContents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#991B1B",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "⚠️ CLIPFLOW ACTION REQUIRED",
          weight: "bold",
          color: "#FCA5A5",
          size: "xs",
          wrap: true,
        },
        {
          type: "text",
          text: "คลิปของคุณถูกสั่งให้ปรับแก้ไข!",
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: "🎬 ชื่อคลิป:",
              color: "#64748B",
              size: "xs",
              wrap: true,
            },
            {
              type: "text",
              text: clipName,
              weight: "bold",
              color: "#0F172A",
              size: "sm",
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "📁 โปรเจกต์:",
              color: "#64748B",
              size: "xs",
              flex: 2,
              wrap: true,
            },
            {
              type: "text",
              text: projectName || "ไม่ระบุ",
              weight: "bold",
              color: "#0F172A",
              size: "xs",
              flex: 5,
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "👨‍⚖️ ผู้ตรวจทาน:",
              color: "#64748B",
              size: "xs",
              flex: 2,
              wrap: true,
            },
            {
              type: "text",
              text: reviewerName || "ทีมผู้ตรวจทาน",
              weight: "bold",
              color: "#991B1B",
              size: "xs",
              flex: 5,
              wrap: true,
            },
          ],
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "box",
          layout: "vertical",
          backgroundColor: "#FEF2F2",
          cornerRadius: "md",
          paddingAll: "md",
          margin: "sm",
          contents: [
            {
              type: "text",
              text: "💬 หมายเหตุจากผู้ตรวจ:",
              weight: "bold",
              color: "#c2bf0fff",
              size: "xs",
              wrap: true,
            },
            {
              type: "text",
              text: comment || "โปรดตรวจสอบคอมเมนต์และปรับแก้ไขตามระบุ",
              color: "#dbd82fff",
              size: "xs",
              wrap: true,
              margin: "xs",
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#DC2626",
          height: "sm",
          action: {
            type: "uri",
            label: "ดูรายละเอียด & ส่งงานใหม่ 🛠️",
            uri: clipUrl,
          },
        },
      ],
    },
  };

  const fallbackText = `⚠️ [ClipFlow Alert] คลิปของคุณถูกสั่งแก้ไข!\n----------------------------------------\n🎬 คลิป: ${clipName}\n📁 โปรเจกต์: ${projectName || "ไม่ระบุ"}\n👨‍⚖️ ผู้ตรวจทาน: ${reviewerName || "ทีมผู้ตรวจทาน"}\n💬 หมายเหตุผู้ตรวจ: ${comment || "โปรดตรวจสอบและแก้ไขงาน"}\n----------------------------------------\n👉 ดูรายละเอียดและส่งงานแก้:\n${clipUrl}`;

  return sendLinePushFlexMessage({
    toLineUserId,
    altText: `⚠️ คลิปของคุณถูกสั่งแก้ไข (${clipName}) - ClipFlow`,
    flexContents,
    fallbackText,
    channelAccessToken,
  });
}

// ─── 3. Clip Approved Notification (Editor Flex Card) ────────────────────────
export async function notifyClipApproved({
  toLineUserId,
  clipName,
  projectName,
  reviewerName,
  comment,
  clipId,
  channelAccessToken,
}: {
  toLineUserId: string;
  clipName: string;
  projectName?: string;
  reviewerName?: string;
  comment?: string;
  clipId: string;
  channelAccessToken?: string;
}) {
  const baseUrl = process.env.NEXTAUTH_URL || "https://clipflow.app";
  const clipUrl = `${baseUrl}/clips/${clipId}`;

  const flexContents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#065F46",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "✅ CLIPFLOW APPROVED",
          weight: "bold",
          color: "#6EE7B7",
          size: "xs",
          wrap: true,
        },
        {
          type: "text",
          text: "คลิปของคุณผ่านการอนุมัติแล้ว!",
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: "🎬 ชื่อคลิป:",
              color: "#64748B",
              size: "xs",
              wrap: true,
            },
            {
              type: "text",
              text: clipName,
              weight: "bold",
              color: "#0F172A",
              size: "sm",
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "📁 โปรเจกต์:",
              color: "#64748B",
              size: "xs",
              flex: 2,
              wrap: true,
            },
            {
              type: "text",
              text: projectName || "ไม่ระบุ",
              weight: "bold",
              color: "#0F172A",
              size: "xs",
              flex: 5,
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "👨‍⚖️ ผู้อนุมัติ:",
              color: "#64748B",
              size: "xs",
              flex: 2,
              wrap: true,
            },
            {
              type: "text",
              text: reviewerName || "ทีมผู้ตรวจทาน",
              weight: "bold",
              color: "#065F46",
              size: "xs",
              flex: 5,
              wrap: true,
            },
          ],
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "box",
          layout: "vertical",
          backgroundColor: "#ECFDF5",
          cornerRadius: "md",
          paddingAll: "md",
          margin: "sm",
          contents: [
            {
              type: "text",
              text: "💬 ความเห็นจากผู้ตรวจ:",
              weight: "bold",
              color: "#065F46",
              size: "xs",
              wrap: true,
            },
            {
              type: "text",
              text: comment || "ผ่านการอนุมัติเรียบร้อยแล้ว",
              color: "#047857",
              size: "xs",
              wrap: true,
              margin: "xs",
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#059669",
          height: "sm",
          action: {
            type: "uri",
            label: "ดูรายละเอียดงานที่อนุมัติ ✨",
            uri: clipUrl,
          },
        },
      ],
    },
  };

  const fallbackText = `✅ [ClipFlow Alert] คลิปอนุมัติแล้ว!\n----------------------------------------\n🎬 คลิป: ${clipName}\n📁 โปรเจกต์: ${projectName || "ไม่ระบุ"}\n👨‍⚖️ ผู้อนุมัติ: ${reviewerName || "ทีมผู้ตรวจทาน"}\n💬 ความเห็น: ${comment || "ผ่านการอนุมัติเรียบร้อย"}\n----------------------------------------\n👉 ดูรายละเอียด:\n${clipUrl}`;

  return sendLinePushFlexMessage({
    toLineUserId,
    altText: `✅ คลิปผ่านการอนุมัติ (${clipName}) - ClipFlow`,
    flexContents,
    fallbackText,
    channelAccessToken,
  });
}

// ─── 4. Submission Pending Review Notification (Editor Flex Card) ────────────
export async function notifySubmissionPending({
  toLineUserId,
  clipName,
  projectName,
  driveUrl,
  submitNote,
  clipId,
  channelAccessToken,
}: {
  toLineUserId: string;
  clipName: string;
  projectName?: string;
  driveUrl?: string;
  submitNote?: string;
  clipId: string;
  channelAccessToken?: string;
}) {
  const baseUrl = process.env.NEXTAUTH_URL || "https://clipflow.app";
  const clipUrl = `${baseUrl}/clips/${clipId}`;

  const flexContents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#92400E",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "📤 CLIPFLOW SUBMISSION",
          weight: "bold",
          color: "#FDE68A",
          size: "xs",
          wrap: true,
        },
        {
          type: "text",
          text: "ส่งคลิปตรวจงานสำเร็จ (รอตรวจ)",
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: "🎬 ชื่อคลิป:",
              color: "#64748B",
              size: "xs",
              wrap: true,
            },
            {
              type: "text",
              text: clipName,
              weight: "bold",
              color: "#0F172A",
              size: "sm",
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "📁 โปรเจกต์:",
              color: "#64748B",
              size: "xs",
              flex: 2,
              wrap: true,
            },
            {
              type: "text",
              text: projectName || "ไม่ระบุ",
              weight: "bold",
              color: "#0F172A",
              size: "xs",
              flex: 5,
              wrap: true,
            },
          ],
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "box",
          layout: "vertical",
          backgroundColor: "#FFFBEB",
          cornerRadius: "md",
          paddingAll: "md",
          margin: "sm",
          contents: [
            {
              type: "text",
              text: "💬 หมายเหตุที่คุณส่ง:",
              weight: "bold",
              color: "#92400E",
              size: "xs",
              wrap: true,
            },
            {
              type: "text",
              text: submitNote || "ไม่มีหมายเหตุเพิ่มเติม",
              color: "#78350F",
              size: "xs",
              wrap: true,
              margin: "xs",
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#D97706",
          height: "sm",
          action: {
            type: "uri",
            label: "ติดตามสถานะคลิป ⏳",
            uri: clipUrl,
          },
        },
      ],
    },
  };

  const fallbackText = `📤 [ClipFlow Alert] ส่งคลิปตรวจงานสำเร็จ (รอตรวจ)\n----------------------------------------\n🎬 คลิป: ${clipName}\n📁 โปรเจกต์: ${projectName || "ไม่ระบุ"}\n🔗 ลิงก์ Drive: ${driveUrl || "-"}\n💬 หมายเหตุที่ส่ง: ${submitNote || "-"}\n----------------------------------------\n⏳ ติดตามสถานะ:\n${clipUrl}`;

  return sendLinePushFlexMessage({
    toLineUserId,
    altText: `📤 ส่งคลิปสำเร็จ (${clipName}) - ClipFlow`,
    flexContents,
    fallbackText,
    channelAccessToken,
  });
}

// ─── 5. Task Assigned Notification (Editor Single Task Flex Card) ────────────
export async function notifyTaskAssigned({
  toLineUserId,
  clipName,
  projectName,
  assignerName,
  clipId,
  channelAccessToken,
}: {
  toLineUserId: string;
  clipName: string;
  projectName?: string;
  assignerName?: string;
  clipId: string;
  channelAccessToken?: string;
}) {
  const baseUrl = process.env.NEXTAUTH_URL || "https://clipflow.app";
  const clipUrl = `${baseUrl}/clips/${clipId}`;

  const flexContents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#4338CA",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "📌 CLIPFLOW NEW TASK",
          weight: "bold",
          color: "#A5B4FC",
          size: "xs",
          wrap: true,
        },
        {
          type: "text",
          text: "คุณได้รับมอบหมายงานใหม่!",
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: "🎬 ชื่อคลิป:",
              color: "#64748B",
              size: "xs",
              wrap: true,
            },
            {
              type: "text",
              text: clipName,
              weight: "bold",
              color: "#0F172A",
              size: "sm",
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "📁 โปรเจกต์:",
              color: "#64748B",
              size: "xs",
              flex: 2,
              wrap: true,
            },
            {
              type: "text",
              text: projectName || "ไม่ระบุ",
              weight: "bold",
              color: "#0F172A",
              size: "xs",
              flex: 5,
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "👤 ผู้มอบหมาย:",
              color: "#64748B",
              size: "xs",
              flex: 2,
              wrap: true,
            },
            {
              type: "text",
              text: assignerName || "ผู้ดูแลระบบ",
              weight: "bold",
              color: "#0F172A",
              size: "xs",
              flex: 5,
              wrap: true,
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#4F46E5",
          height: "sm",
          action: {
            type: "uri",
            label: "รับงาน & ดูรายละเอียด 📌",
            uri: clipUrl,
          },
        },
      ],
    },
  };

  const fallbackText = `📌 [ClipFlow Alert] คุณได้รับมอบหมายงานใหม่!\n----------------------------------------\n🎬 คลิป: ${clipName}\n📁 โปรเจกต์: ${projectName || "ไม่ระบุ"}\n👤 ผู้มอบหมาย: ${assignerName || "ผู้ดูแลระบบ"}\n----------------------------------------\n👉 รับงาน & ดูรายละเอียด:\n${clipUrl}`;

  return sendLinePushFlexMessage({
    toLineUserId,
    altText: `📌 คุณได้รับมอบหมายงานใหม่ (${clipName}) - ClipFlow`,
    flexContents,
    fallbackText,
    channelAccessToken,
  });
}

// ─── 6. Bundled Tasks Assigned Notification (Editor Multi-Task Flex Card) ────
export async function notifyTasksAssigned({
  toLineUserId,
  tasks,
  assignerName,
  channelAccessToken,
}: {
  toLineUserId: string;
  tasks: Array<{
    clipId: string;
    clipName: string;
    projectName?: string;
  }>;
  assignerName?: string;
  channelAccessToken?: string;
}) {
  if (!tasks || tasks.length === 0)
    return { success: false, message: "No tasks provided" };

  const baseUrl = process.env.NEXTAUTH_URL || "https://clipflow.app";

  if (tasks.length === 1) {
    const single = tasks[0];
    return notifyTaskAssigned({
      toLineUserId,
      clipName: single.clipName,
      projectName: single.projectName,
      assignerName,
      clipId: single.clipId,
      channelAccessToken,
    });
  }

  // Multi-task Flex Message (Bundled Card)
  const taskListContents: any[] = [];

  tasks.forEach((t, idx) => {
    if (idx > 0) {
      taskListContents.push({ type: "separator", margin: "sm" });
    }

    taskListContents.push({
      type: "box",
      layout: "vertical",
      margin: "sm",
      spacing: "xs",
      contents: [
        {
          type: "box",
          layout: "baseline",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: `${idx + 1}.`,
              weight: "bold",
              color: "#4338CA",
              size: "xs",
              flex: 1,
              wrap: true,
            },
            {
              type: "text",
              text: t.clipName,
              weight: "bold",
              color: "#0F172A",
              size: "xs",
              flex: 9,
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: `📁 ${t.projectName || "ไม่ระบุ"}`,
              color: "#64748B",
              size: "xxs",
              flex: 1,
              wrap: true,
            },
          ],
        },
      ],
    });
  });

  const flexContents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#4338CA",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "📌 CLIPFLOW BUNDLED ASSIGNMENT",
          weight: "bold",
          color: "#A5B4FC",
          size: "xs",
          wrap: true,
        },
        {
          type: "text",
          text: `มอบหมายงานใหม่ (${tasks.length} รายการ)!`,
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "👤 ผู้มอบหมายงาน:",
              color: "#64748B",
              size: "xs",
              flex: 3,
              wrap: true,
            },
            {
              type: "text",
              text: assignerName || "ผู้ดูแลระบบ",
              weight: "bold",
              color: "#0F172A",
              size: "xs",
              flex: 7,
              wrap: true,
            },
          ],
        },
        {
          type: "separator",
          margin: "sm",
        },
        {
          type: "box",
          layout: "vertical",
          contents: taskListContents,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#4F46E5",
          height: "sm",
          action: {
            type: "uri",
            label: `เปิดดูงานทั้งหมด (${tasks.length} คลิป) 🚀`,
            uri: `${baseUrl}/tasks`,
          },
        },
      ],
    },
  };

  const fallbackText = `📌 [ClipFlow Alert] มอบหมายงานใหม่ (${tasks.length} รายการ)\n----------------------------------------\n👤 ผู้มอบหมาย: ${assignerName || "ผู้ดูแลระบบ"}\n${tasks.map((t, i) => `${i + 1}. ${t.clipName} (${t.projectName || "ไม่ระบุ"})`).join("\n")}\n----------------------------------------\n👉 เปิดดูงานทั้งหมด: ${baseUrl}/tasks`;

  return sendLinePushFlexMessage({
    toLineUserId,
    altText: `📌 มอบหมายงานใหม่ ${tasks.length} รายการ - ClipFlow`,
    flexContents,
    fallbackText,
    channelAccessToken,
  });
}

// ─── 7. Admin Group New Submission Notification (Flex Card to Admin Group) ──
export async function notifyAdminGroupNewSubmission({
  clipName,
  projectName,
  editorName,
  submitNote,
  clipId,
  channelAccessToken,
  adminGroupId,
}: {
  clipName: string;
  projectName?: string;
  editorName?: string;
  submitNote?: string;
  clipId: string;
  channelAccessToken?: string;
  adminGroupId?: string;
}) {
  const targetId = adminGroupId || (process.env as any)?.LINE_REVIEWER_GROUP_ID;

  if (!targetId) {
    console.warn("[LINE GROUP] LINE_REVIEWER_GROUP_ID is missing. Notification skipped.");
    return { success: false, message: "Missing LINE_REVIEWER_GROUP_ID" };
  }

  const baseUrl = process.env.NEXTAUTH_URL || "https://clipflow.app";
  const clipUrl = `${baseUrl}/clips/${clipId}`;

  const flexContents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#D97706",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "📥 ADMIN ALERT - HAS NEW SUBMISSION",
          weight: "bold",
          color: "#FDE68A",
          size: "xs",
          wrap: true,
        },
        {
          type: "text",
          text: "มีคลิปใหม่ส่งรอคุณตรวจ!",
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          contents: [
            {
              type: "text",
              text: "🎬 ชื่อคลิป:",
              color: "#64748B",
              size: "xs",
              wrap: true,
            },
            {
              type: "text",
              text: clipName,
              weight: "bold",
              color: "#0F172A",
              size: "sm",
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "📁 โปรเจกต์:",
              color: "#64748B",
              size: "xs",
              flex: 3,
              wrap: true,
            },
            {
              type: "text",
              text: projectName || "ไม่ระบุ",
              weight: "bold",
              color: "#0F172A",
              size: "xs",
              flex: 7,
              wrap: true,
            },
          ],
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: "👤 ตัดต่อโดย:",
              color: "#64748B",
              size: "xs",
              flex: 3,
              wrap: true,
            },
            {
              type: "text",
              text: editorName || "Editor",
              weight: "bold",
              color: "#D97706",
              size: "xs",
              flex: 7,
              wrap: true,
            },
          ],
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "box",
          layout: "vertical",
          backgroundColor: "#FFFBEB",
          cornerRadius: "md",
          paddingAll: "md",
          margin: "sm",
          contents: [
            {
              type: "text",
              text: "💬 หมายเหตุงาน:",
              weight: "bold",
              color: "#D97706",
              size: "xs",
              wrap: true,
            },
            {
              type: "text",
              text: submitNote || "ไม่มีหมายเหตุเพิ่มเติม",
              color: "#78350F",
              size: "xs",
              wrap: true,
              margin: "xs",
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#D97706",
          height: "sm",
          action: {
            type: "uri",
            label: "เปิดตรวจงานและให้ความเห็น 🔍",
            uri: clipUrl,
          },
        },
      ],
    },
  };

  const fallbackText = `📥 [ClipFlow Admin] มีคลิปใหม่ส่งรอตรวจ!\n----------------------------------------\n🎬 คลิป: ${clipName}\n📁 โปรเจกต์: ${projectName || "ไม่ระบุ"}\n👤 ตัดต่อโดย: ${editorName || "Editor"}\n💬 หมายเหตุ: ${submitNote || "-"}\n----------------------------------------\n👉 เปิดตรวจงาน: ${clipUrl}`;

  return sendLinePushFlexMessage({
    toLineUserId: targetId,
    altText: `📥 มีคลิปใหม่ส่งรอตรวจ (${clipName}) - ClipFlow`,
    flexContents,
    fallbackText,
    channelAccessToken,
  });
}

/**
 * Build Flex Card for 'สรุปงานวันนี้' Group Command
 */
export function buildDailySummaryFlexCard({
  pending,
  revision,
  approved,
  total,
}: {
  pending: number;
  revision: number;
  approved: number;
  total: number;
}) {
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#1E293B",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "📊 สรุปภาพรวมงานวันนี้",
          weight: "bold",
          color: "#F8FAFC",
          size: "lg",
        },
        {
          type: "text",
          text: "ระบบติดตามงานตัดต่อวิดีโอ ClipFlow",
          color: "#94A3B8",
          size: "xs",
          margin: "xs",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "lg",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "📥 รอตรวจงาน:",
              size: "sm",
              color: "#64748B",
            },
            {
              type: "text",
              text: `${pending} คลิป`,
              size: "sm",
              weight: "bold",
              color: "#D97706",
              align: "end",
            },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "⚠️ อยู่ระหว่างสั่งแก้:",
              size: "sm",
              color: "#64748B",
            },
            {
              type: "text",
              text: `${revision} คลิป`,
              size: "sm",
              weight: "bold",
              color: "#E11D48",
              align: "end",
            },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "✅ ผ่านอนุมัติ:",
              size: "sm",
              color: "#64748B",
            },
            {
              type: "text",
              text: `${approved} คลิป`,
              size: "sm",
              weight: "bold",
              color: "#059669",
              align: "end",
            },
          ],
        },
        { type: "separator", margin: "md" },
        {
          type: "box",
          layout: "horizontal",
          margin: "md",
          contents: [
            {
              type: "text",
              text: "🎬 รวมคลิปทั้งหมด:",
              size: "sm",
              weight: "bold",
              color: "#1E293B",
            },
            {
              type: "text",
              text: `${total} คลิป`,
              size: "sm",
              weight: "bold",
              color: "#2563EB",
              align: "end",
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#2563EB",
          height: "sm",
          action: {
            type: "uri",
            label: "เข้าสู่ระบบเพื่อจัดการงาน 🚀",
            uri: "https://referring-opening-yoga-went.trycloudflare.com/dashboard",
          },
        },
      ],
    },
  };
}

/**
 * Build Flex Card for 'งานของฉัน' Group Command
 */
export function buildMyTasksFlexCard({
  displayName,
  clips,
}: {
  displayName: string;
  clips: any[];
}) {
  const clipItems = clips.slice(0, 5).map((clip) => ({
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      {
        type: "text",
        text: `🎬 ${clip.name}`,
        size: "xs",
        weight: "bold",
        color: "#1E293B",
        flex: 3,
        wrap: true,
      },
      {
        type: "text",
        text:
          clip.status === "APPROVED"
            ? "✅ ผ่าน"
            : clip.status === "NEEDS_REVISION"
              ? "⚠️ ต้องแก้"
              : clip.status === "PENDING_REVIEW"
                ? "⏳ รอตรวจ"
                : "📝 ร่าง",
        size: "xs",
        weight: "bold",
        color:
          clip.status === "APPROVED"
            ? "#059669"
            : clip.status === "NEEDS_REVISION"
              ? "#E11D48"
              : "#D97706",
        align: "end",
        flex: 2,
      },
    ],
  }));

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#2563EB",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: `📋 งานของ ${displayName}`,
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
        },
        {
          type: "text",
          text: `มีงานทั้งหมด ${clips.length} คลิปในระบบ`,
          color: "#93C5FD",
          size: "xs",
          margin: "xs",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "lg",
      contents:
        clips.length === 0
          ? [
              {
                type: "text",
                text: "🎉 ยินดีด้วย! คุณไม่มีงานค้างในขณะนี้",
                size: "sm",
                color: "#059669",
                align: "center",
              },
            ]
          : clipItems,
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#2563EB",
          height: "sm",
          action: {
            type: "uri",
            label: "เปิดดูงานทั้งหมดในระบบ 🔍",
            uri: "https://referring-opening-yoga-went.trycloudflare.com/tasks",
          },
        },
      ],
    },
  };
}

/**
 * Build Flex Card Menu for 1-on-1 Private LINE Chat with Editor
 */
export function buildEditorPrivateMenuFlexCard({
  displayName,
}: {
  displayName?: string;
}) {
  const baseUrl =
    process.env.NEXTAUTH_URL || "https://clipflow-tmyda.vercel.app";

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#1E293B",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "🎬 CLIPFLOW EDITOR ASSISTANT",
          weight: "bold",
          color: "#38BDF8",
          size: "xs",
          wrap: true,
        },
        {
          type: "text",
          text: `สลาม👋 คุณ ${displayName || "นักตัดต่อ"}`,
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: "ยินดีต้อนรับสู่ระบบจัดการงานตัดต่อวิดีโอ ClipFlow 🚀 คุณสามารถกดเลือกเมนูด้านล่าง หรือพิมพ์คำสั่งตอบกลับได้ทันที:",
          size: "xs",
          color: "#64748B",
          wrap: true,
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "secondary",
              color: "#F1F5F9",
              height: "sm",
              action: {
                type: "message",
                label: "📋 ดูงานของฉัน (พิมพ์ 'งานของฉัน')",
                text: "งานของฉัน",
              },
            },
            {
              type: "button",
              style: "secondary",
              color: "#F1F5F9",
              height: "sm",
              action: {
                type: "message",
                label: "📊 ดูสรุปภาพรวมวันนี้",
                text: "สรุปงานวันนี้",
              },
            },
            {
              type: "button",
              style: "primary",
              color: "#0284C7",
              height: "sm",
              action: {
                type: "uri",
                label: "📤 เข้าหน้าส่งคลิปงานใหม่",
                uri: `${baseUrl}/submit`,
              },
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "link",
          height: "sm",
          action: {
            type: "uri",
            label: "🌐 เปิดเว็บไซต์ ClipFlow",
            uri: baseUrl,
          },
        },
      ],
    },
  };
}

// ─── 8. Reviewer Role Granted Notification (Send Group Link to New Reviewer) ──
export async function notifyReviewerRoleGranted({
  toLineUserId,
  displayName,
  channelAccessToken,
}: {
  toLineUserId: string;
  displayName: string;
  groupInviteUrl?: string;
  channelAccessToken?: string;
}) {
  const baseUrl = process.env.NEXTAUTH_URL || "https://clipflow.app";
  const inviteUrl = "https://line.me/ti/g/vugydTHe7q";

  const flexContents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#2563EB",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "🎉 ROLE UPGRADE NOTIFICATION",
          weight: "bold",
          color: "#93C5FD",
          size: "xs",
        },
        {
          type: "text",
          text: "คุณได้รับสิทธิ์เป็นผู้ตรวจทานแล้ว!",
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
          margin: "xs",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        {
          type: "text",
          text: `สวัสดีคุณ ${displayName} 👋\n\nแอดมินได้ปรับยศสิทธิ์บัญชีของคุณเป็น "REVIEWER (ผู้ตรวจงาน)" เรียบร้อยแล้ว!`,
          size: "sm",
          color: "#334155",
          wrap: true,
        },
        {
          type: "text",
          text: "กรุณากดปุ่มด้านล่างเพื่อ เข้าร่วมกลุ่ม LINE ทีมตรวจงาน สำหรับรับแจ้งเตือนเมื่อมีคลิปใหม่ส่งเข้ามาตรวจ:",
          size: "xs",
          color: "#64748B",
          margin: "md",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#06C755",
          height: "sm",
          action: {
            type: "uri",
            label: "เข้าร่วมกลุ่ม LINE รับแจ้งเตือน 👥",
            uri: inviteUrl,
          },
        },
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: {
            type: "uri",
            label: "เข้าสู่ระบบ ClipFlow Web App 🌐",
            uri: `${baseUrl}/dashboard`,
          },
        },
      ],
    },
  };

  const fallbackText = `🎉 [ClipFlow] คุณ ${displayName} ได้รับสิทธิ์เป็นผู้ตรวจทาน (REVIEWER) เรียบร้อยแล้ว!\n\n👉 เข้าร่วมกลุ่ม LINE รับแจ้งเตือนงานตรวจคลิปใหม่:\n${inviteUrl}`;

  return sendLinePushFlexMessage({
    toLineUserId,
    altText: "🎉 คุณได้รับสิทธิ์เป็นผู้ตรวจทาน (REVIEWER) - ClipFlow",
    flexContents,
    fallbackText,
    channelAccessToken,
  });
}

/**
 * Build Flex Card for 'งานที่ต้องตรวจ' Group Command
 */
export function buildPendingReviewFlexCard({
  pending,
  revision,
}: {
  pending: number;
  revision: number;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://clipflow.app";
  
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#4F46E5",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "🔍 งานที่รอการตรวจสอบ",
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "ผู้ตรวจเตรียมตัว! ตอนนี้มีงานที่รออยู่ในระบบดังนี้:",
          size: "sm",
          color: "#475569",
          wrap: true,
        },
        {
          type: "box",
          layout: "vertical",
          margin: "md",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "⏳ รอคุณตรวจ (Pending):",
                  color: "#64748B",
                  size: "sm",
                  flex: 3,
                  wrap: true,
                },
                {
                  type: "text",
                  text: `${pending} งาน`,
                  weight: "bold",
                  color: "#D97706",
                  size: "sm",
                  flex: 2,
                  align: "end",
                },
              ],
            },
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "⚠️ รอ Editor แก้ (Revision):",
                  color: "#64748B",
                  size: "sm",
                  flex: 3,
                  wrap: true,
                },
                {
                  type: "text",
                  text: `${revision} งาน`,
                  weight: "bold",
                  color: "#E11D48",
                  size: "sm",
                  flex: 2,
                  align: "end",
                },
              ],
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "lg",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#4F46E5",
          action: {
            type: "uri",
            label: "เข้าไปตรวจงาน 🚀",
            uri: `${baseUrl}/dashboard`,
          },
        },
      ],
    },
  };
}

/**
 * Build Flex Card to prompt unregistered users to login
 */
export function buildLoginRequiredFlexCard() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://clipflow.app";
  
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#E11D48",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "🔒 กรุณาเข้าสู่ระบบก่อนใช้งาน",
          weight: "bold",
          color: "#FFFFFF",
          size: "lg",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "lg",
      contents: [
        {
          type: "text",
          text: "บัญชี LINE ของคุณยังไม่ได้ผูกกับระบบ ClipFlow กรุณาเข้าสู่ระบบผ่านปุ่มด้านล่างเพื่อยืนยันตัวตนครับ",
          size: "sm",
          color: "#475569",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "lg",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#E11D48",
          action: {
            type: "uri",
            label: "เปิดระบบเข้าใช้งาน",
            uri: baseUrl,
          },
        },
      ],
    },
  };
}
