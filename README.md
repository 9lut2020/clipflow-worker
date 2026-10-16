# ClipFlow - Backend API Worker

> ส่วนประมวลผลหลักของระบบ **ClipFlow** — Serverless API ประสิทธิภาพสูง ทำงานบน Cloudflare Workers ขับเคลื่อนด้วย Hono Framework, Neon Serverless PostgreSQL และ Drizzle ORM รองรับการแจ้งเตือนผ่าน LINE Messaging API, Webhook ตอบโต้อัตโนมัติ, Web Push และระบบงาน Background Crons

---

## สารบัญ

- [ภาพรวมของระบบ (Overview)](#ภาพรวมของระบบ-overview)
- [เทคโนโลยีที่ใช้ (Tech Stack)](#เทคโนโลยีที่ใช้-tech-stack)
- [โครงสร้างโมโนรีโปภายใน (Internal Packages)](#โครงสร้างโมโนรีโปภายใน-internal-packages)
- [สถาปัตยกรรมและการทำงาน (Architecture & Middleware)](#สถาปัตยกรรมและการทำงาน-architecture--middleware)
- [โครงสร้างโฟลเดอร์ (Directory Structure)](#โครงสร้างโฟลเดอร์-directory-structure)
- [ฐานข้อมูลและการทำ Migration (Database & Migrations)](#ฐานข้อมูลและการทำ-migration-database--migrations)
- [รายการ API Endpoints (API Routes Reference)](#รายการ-api-endpoints-api-routes-reference)
- [LINE Webhook & Bot Integration](#line-webhook--bot-integration)
- [การตั้งค่า Environment Variables & Secrets](#การตั้งค่า-environment-variables--secrets)
- [การติดตั้งและเริ่มใช้งาน (Getting Started)](#การติดตั้งและเริ่มใช้งาน-getting-started)
- [สคริปต์คำสั่งที่ใช้งานได้ (Available Scripts)](#สคริปต์คำสั่งที่ใช้งานได้-available-scripts)
- [การ Deploy สู่ Cloudflare Workers](#การ-deploy-สู่-cloudflare-workers)
- [ประสิทธิภาพและความปลอดภัย (Performance & Security)](#ประสิทธิภาพและความปลอดภัย-performance--security)
- [แนวทางการแก้ไขปัญหา (Troubleshooting & Operations)](#แนวทางการแก้ไขปัญหา-troubleshooting--operations)

---

## ภาพรวมของระบบ (Overview)

Backend Worker รับผิดชอบการทำงานเบื้องหลังทั้งหมดของ ClipFlow:
- **Core CRUD & Business Logic**: บริหารจัดการคลิป, โปรเจกต์, ตอน (Episodes), ผู้ใช้งาน, และประวัติการขอแก้ไข (Revisions)
- **Review Workflow & Checklists**: ตรวจสอบเงื่อนไขการส่งคลิป ตรวจสอบสถานะการ Approve / Request Revision
- **LINE Integration & Automation**: ส่ง Flex Message แจ้งเตือนสถานะคลิปแบบเรียลไทม์ และมี Webhook ตอบกลับข้อความอัจฉริยะ (เช่น สรุปงานประจำวัน, เช็กงานค้าง)
- **Background Cron Triggers**: รวบรวมสถิติประสิทธิภาพการทำงาน (Analytics Aggregation) ทุกเที่ยงคืน (เวลาไทย)
- **High-speed Edge Execution**: ทำงานแบบ Serverless ปรับสเกลได้รวดเร็ว ตอบสนองในระดับ Millisecond ด้วย Cloudflare Workers และ Neon

---

## เทคโนโลยีที่ใช้ (Tech Stack)

| ส่วนประกอบ | รายละเอียด |
| :--- | :--- |
| **Runtime** | [Cloudflare Workers](https://workers.cloudflare.com/) (Edge Serverless V8 Isolate) |
| **Web Framework** | [Hono](https://hono.dev/) v4 (Lightweight, Express-like syntax, Web Standard compliant) |
| **Database** | [Neon](https://neon.tech/) Serverless PostgreSQL |
| **ORM & Tooling** | [Drizzle ORM](https://orm.drizzle.team/) & Drizzle Kit |
| **Connection Pooling** | Cloudflare [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) (Opt-in TCP pooling) |
| **Data Validation** | [Zod](https://zod.dev/) & `@hono/zod-validator` |
| **Messaging & Notify** | LINE Messaging API (Flex Messages) & Web Push (`@block65/webcrypto-web-push`) |
| **Background Tasks** | Cloudflare Queues & Cron Triggers (`scheduled`) |
| **CLI & Runtime Tool** | [Wrangler](https://developers.cloudflare.com/workers/wrangler/) & [tsx](https://github.com/privatenumber/tsx) |

---

## โครงสร้างโมโนรีโปภายใน (Internal Packages)

Backend ได้รับการจัดโครงสร้างแบบ Monorepo ย่อย (pnpm workspace) แบ่งโค้ดออกเป็นแพ็กเกจเพื่อให้โค้ดสะอาดและนำไปแชร์ต่อได้:

```
backend/packages/
├── db/            # @clipflow/db: รวม Drizzle Schema, นิยามความสัมพันธ์ และ DB Client Factory
├── lib/           # @clipflow/lib: ฟังก์ชันอรรถประโยชน์ส่วนกลาง
├── types/         # @clipflow/types: Type definitions, สัญญาข้อมูล (API Contracts)
└── validations/   # @clipflow/validations: Zod Schema สำหรับตรวจสอบ Request Payload
```

---

## สถาปัตยกรรมและการทำงาน (Architecture & Middleware)

ทุก Request ที่วิ่งเข้ามาใน Worker จะไหลผ่าน Middleware ตามลำดับดังนี้:

```
[ Incoming Request ]
        │
        ├─► 1. CORS Middleware (ตรวจ Origin ตาม CORS_ORIGINS)
        ├─► 2. Logger & Secure Headers
        ├─► 3. Request Tracing (แนบ/ส่งต่อ x-request-id)
        ├─► 4. Latency Tracing (คำนวณและตอบกลับ Server-Timing header)
        ├─► 5. Cache-Control (กำหนด private, no-store สำหรับ /api/*)
        ├─► 6. DB Connection Injection (สลับระหว่าง Neon HTTP หรือ Hyperdrive TCP)
        │
        ▼
[ Route Handling ]
        ├─► Public Routes: / (Root), /api/health
        ├─► LINE Webhook: /webhook/line (ตรวจสอบ HMAC-SHA256 signature)
        ├─► Internal Routes: /api/internal/* (ป้องกันด้วย x-internal-secret)
        └─► Authenticated Routes: /api/* (ตรวจสอบสิทธิ์ผ่าน authMiddleware)
        │
        ▼
[ 5xx Error Handler & LINE Alert ]
        └─► หากเกิด Error รหัส 500+ ระบบจะยิง Alert สู่ LINE Ops Group ทันที (พร้อม Throttling)
```

---

## โครงสร้างโฟลเดอร์ (Directory Structure)

```bash
backend/
├── drizzle/                     # SQL Migrations ที่สร้างโดย Drizzle Kit
├── packages/                    # โมดูลและไลบรารีภายใน (@clipflow/*)
│   ├── db/                      # Schema, Migrations, DB Connection
│   │   ├── migrations/          # ไฟล์ migration ย่อย
│   │   ├── src/                 # schema.ts, index.ts
│   │   └── package.json
│   ├── lib/                     # ฟังก์ชัน Helper กลาง
│   ├── types/                   # Type definitions
│   └── validations/             # Zod validation schema
├── scripts/                     # สคริปต์รันงาน Maintenance ฐานข้อมูล
│   ├── apply-performance-indexes.ts # สร้าง Index เพิ่มความเร็วในการสืบค้น
│   ├── clean-db.ts              # ล้างข้อมูลตารางสำหรับการทดสอบ
│   └── crud-test.ts             # ทดสอบการเชื่อมต่อและการทำ CRUD
├── src/                         # ซอร์สโค้ดหลักของ Worker API
│   ├── cron/                    # งานที่รันตามเวลา (Cron Tasks)
│   │   └── analytics-aggregator.ts # รวบรวมสถิติรายวัน
│   ├── lib/                     # Helper ประจำ Worker
│   │   ├── api-contract.ts      # โครงสร้าง Response มาตรฐาน
│   │   └── frontend-url.ts      # ตัวจัดการ URL เชื่อมโยงกลับหน้าเว็บ
│   ├── middleware/              # ตัวกรองคำขอ
│   │   ├── auth.ts              # ตรวจสอบ Identity, Token, และ Internal Secret
│   │   └── role.ts              # ตรวจสอบสิทธิ์ (Admin / Reviewer / Editor)
│   ├── routes/                  # API Route Controllers แต่ละส่วน
│   │   ├── activity-logs.ts     # บันทึกประวัติการกระทำในระบบ
│   │   ├── admin.ts             # การจัดการระบบระดับผู้ดูแล
│   │   ├── analytics.ts         # ดึงข้อมูลสถิติและผลการดำเนินงาน
│   │   ├── assets.ts            # จัดการไฟล์ Asset
│   │   ├── checklists.ts        # เช็กลิสต์การตรวจงาน
│   │   ├── clips.ts             # CRUD และ State Machine ของคลิป
│   │   ├── episodes.ts          # จัดการตอนในแต่ละโปรเจกต์
│   │   ├── internal.ts          # Endpoint สำหรับงานภายใน (Sync, Health probe)
│   │   ├── notifications.ts     # การแจ้งเตือนและ Web Push
│   │   ├── projects.ts          # จัดการโปรเจกต์
│   │   ├── publish-schedules.ts # ตารางวัน-เวลาการเผยแพร่คลิป
│   │   ├── revisions.ts         # จัดการการส่งแก้คลิปและประวัติการแก้
│   │   ├── users.ts             # โปรไฟล์และรายชื่อสมาชิกในทีม
│   │   └── video-sizes.ts       # ขนาดและสัดส่วนของวิดีโอ (16:9, 9:16 ฯลฯ)
│   ├── services/                # บริการและ Business Logic
│   │   ├── notifications/       # ตัวส่งแจ้งเตือน (LINE Flex Message, Web Push)
│   │   ├── clip.service.ts      # คำนวณสถานะคลิปและสิทธิ์
│   │   ├── project.service.ts   # ตรรกะโปรเจกต์
│   │   ├── revision.service.ts  # ตรรกะงานแก้ไข
│   │   ├── system-alerts.ts     # ระบบแจ้งเตือน Error ฉุกเฉินเข้ากลุ่ม LINE Ops
│   │   └── user.service.ts      # บริการผู้ใช้งาน
│   └── index.ts                 # Entrypoint หลักของ Worker, Routes, Crons & Queue
├── .dev.vars.example            # ตัวอย่าง Environment สำหรับ Local Development
├── drizzle.config.ts            # การตั้งค่า Drizzle Kit
├── migrate.ts                   # สคริปต์รัน Database Migration
├── package.json                 # การตั้งค่า Dependencies และ Scripts
└── wrangler.toml                # การตั้งค่า Cloudflare Workers
```

---

## ฐานข้อมูลและการทำ Migration (Database & Migrations)

### โครงสร้างตารางหลัก (Core Tables)
- **users**: เก็บข้อมูลผู้ใช้, สิทธิ์ (`ADMIN`, `REVIEWER`, `EDITOR`), LINE User ID และสถานะ
- **projects**: ข้อมูลโปรเจกต์, โฟลเดอร์ Google Drive ปลายทาง, ผู้รับผิดชอบ
- **episodes**: ตอนหรือ EP ย่อยภายใต้โปรเจกต์
- **clips**: คลิปงาน, ลิงก์ Drive, สถานะ (`PENDING_REVIEW`, `IN_REVIEW`, `NEEDS_REVISION`, `APPROVED`, `PUBLISHED`)
- **revisions**: บันทึกรอบการส่งแก้ ความคิดเห็น และ Checklist ที่ยังไม่ผ่าน
- **notifications**: ประวัติการแจ้งเตือนและสถานะการเปิดอ่าน
- **publish_schedules**: กำหนดการเผยแพร่คลิปสู่แพลตฟอร์มต่างๆ (YouTube, TikTok, Facebook)
- **assets**: แหล่งรวมไฟล์วัตถุดิบ กราฟิก และเพลงประกอบ

### คำสั่ง Migration และ Indexes
```bash
# 1. รัน Migration ขึ้นฐานข้อมูล Neon
pnpm db:migrate

# 2. สร้าง Performance Indexes เพื่อเพิ่มความเร็ว Query (Idempotent)
pnpm db:index

# ตรวจสอบคำสั่ง SQL ของ Index ก่อนรันจริง
pnpm db:index:dry
```

---

## รายการ API Endpoints (API Routes Reference)

### 1. สาธารณะ & Health Check
- `GET /` : สรุปสถานะทั่วไปของ Service
- `GET /api/health` : Liveness probe สำหรับตรวจสอบความพร้อม (ไม่ต่อ DB)

### 2. LINE Webhook
- `POST /webhook/line` : รับ Webhook Event จาก LINE Platform (พร้อมตรวจสอบ Signature `x-line-signature`)

### 3. Internal System API (Protected via `x-internal-secret`)
- `ALL /api/internal/*` : ใช้สำหรับงานระบบ งานซิงค์ข้อมูล หรือสื่อสารโดยตรงกับ Next.js Server

### 4. Authenticated Resource APIs (Protected via `authMiddleware`)
| Method & Route | รายละเอียด |
| :--- | :--- |
| `GET /api/clips`, `POST /api/clips` | ค้นหารายการคลิป / สร้างคลิปใหม่ |
| `GET /api/clips/:id`, `PATCH /api/clips/:id` | รายละเอียดคลิป / ปรับปรุงข้อมูลคลิป |
| `POST /api/clips/:id/approve` | อนุมัติคลิป (เฉพาะ Reviewer/Admin) |
| `POST /api/clips/:id/reject` | ขอแก้ไขคลิป (ส่งเข้าสู่สถานะ `NEEDS_REVISION`) |
| `GET /api/projects`, `POST /api/projects` | จัดการโปรเจกต์ |
| `GET /api/episodes` | ดึงรายการตอน |
| `GET /api/revisions`, `POST /api/revisions` | ประวัติการแก้ไขคลิป |
| `GET /api/users` | ข้อมูลผู้ใช้งานในระบบ |
| `GET /api/analytics/overview` | ข้อมูลสถิติ Dashboard |
| `GET /api/publish-schedules` | ดึงและจัดตารางปล่อยคลิป |
| `GET /api/notifications` | ดึงรายการแจ้งเตือนของผู้ใช้ |
| `GET /api/assets`, `POST /api/assets` | จัดการ Assets ของโปรเจกต์ |
| `GET /api/checklists` | เกณฑ์การตรวจคลิปตามหมวดหมู่ |

---

## LINE Webhook & Bot Integration

ระบบรองรับการรับข้อความจาก LINE ทั้งใน **แชตส่วนตัว (1-on-1)** และ **กลุ่มงาน (Group Chat)**:

### คำสั่งโต้ตอบอัตโนมัติในกลุ่มงาน:
1. **"สรุปงานวันนี้"**: บอทจะนับจำนวนคลิปที่รอตรวจ, คลิปที่ต้องแก้, คลิปที่ผ่านแล้ว และส่งสรุปเป็นการ์ด Flex Message
2. **"งานที่ต้องตรวจ"**: บอทจะดึงรายการงานคลิปที่อยู่ในสถานะรอรีวิว พร้อมลิงก์เปิดตรวจงานทันที

### ความปลอดภัยของ Webhook:
- ทุกคำขอที่เข้ามายัง `/webhook/line` จะถูกคำนวณ Hash HMAC-SHA256 ด้วย `LINE_CHANNEL_SECRET` เทียบกับส่วนหัว `x-line-signature` เสมอ เพื่อป้องกันคำขอปลอม

---

## การตั้งค่า Environment Variables & Secrets

### 1. ตัวแปรใน `wrangler.toml` (Environment Variables)
```toml
[vars]
ENVIRONMENT = "production"             # "development" หรือ "production"
DB_DRIVER = "neon-http"               # "neon-http" หรือ "hyperdrive"
FRONTEND_URL = "https://clipflow.example.com" # URL สำหรับลิงก์ในการ์ด LINE
CORS_ORIGINS = "https://clipflow.example.com,http://localhost:3000"
```

### 2. รหัสลับ (Secrets) — เพิ่มผ่าน Wrangler CLI
ห้ามใส่รหัสผ่านเหล่านี้ในไฟล์ที่ Commit ขึ้น Git:
```bash
# Connection String สำหรับฐานข้อมูล Neon PostgreSQL
npx wrangler secret put DATABASE_URL

# Shared Secret สำหรับสื่อสารกับ Frontend Next.js Proxy
npx wrangler secret put INTERNAL_API_SECRET

# กุญแจและโทเค็นจาก LINE Developers Console
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_LIFF_ID

# รหัสสำหรับระบบความปลอดภัยและการแจ้งเตือน
npx wrangler secret put JWT_SECRET
npx wrangler secret put LINE_ALERT_GROUP_ID        # LINE Group ID สำหรับรับแจ้งเตือนเมื่อระบบมี Error 5xx
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY  # สำหรับตรวจสอบสิทธิ์ Google Drive (ถ้ามี)
```

### 3. การรันใน Local (`.dev.vars`)
สร้างไฟล์ `.dev.vars` ขึ้นมาในโฟลเดอร์ `backend/` โดยคัดลอกรูปแบบจาก `.dev.vars.example`:
```bash
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/clipflow?sslmode=require
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_CHANNEL_SECRET=your_secret
INTERNAL_API_SECRET=your_local_shared_secret
ENVIRONMENT=development
FRONTEND_URL=http://localhost:3000
```

---

## การติดตั้งและเริ่มใช้งาน (Getting Started)

### สิ่งที่จำเป็นต้องมีก่อนติดตั้ง (Prerequisites)
- [Node.js](https://nodejs.org/) version 20 ขึ้นไป
- [pnpm](https://pnpm.io/)
- บัญชี Cloudflare พร้อมติดตั้ง Wrangler CLI

### ขั้นตอนการรันระบบใน Local

1. **ติดตั้ง Dependencies**:
   ```bash
   cd backend
   pnpm install
   ```

2. **เตรียมการเชื่อมต่อฐานข้อมูล**:
   - สร้างไฟล์ `.dev.vars` และระบุ `DATABASE_URL` ให้เรียบร้อย
   - รันการ Migrate และเตรียมดัชนี:
     ```bash
     pnpm db:migrate
     pnpm db:index
     ```

3. **รัน Development Server**:
   ```bash
   pnpm dev
   ```
   *Worker จะเริ่มต้นทำงานที่: `http://127.0.0.1:8787`*

4. **ทดสอบความพร้อมของระบบ**:
   ```bash
   curl http://127.0.0.1:8787/api/health
   # ควรได้รับ: {"status":"ok","service":"clipflow-api",...}
   ```

---

## สคริปต์คำสั่งที่ใช้งานได้ (Available Scripts)

| คำสั่ง | คำอธิบาย |
| :--- | :--- |
| `pnpm dev` | รัน Wrangler Local Dev Server ที่พอร์ต 8787 |
| `pnpm build` | ทดสอบความพร้อมของ Worker ก่อน Deploy (`wrangler deploy --dry-run`) |
| `pnpm deploy` | Deploy ซอร์สโค้ดขึ้น Cloudflare Workers แบบ Production |
| `pnpm type-check` | ตรวจสอบ Type ด้วย TypeScript (`tsc --noEmit`) |
| `pnpm cf-typegen` | อัปเดต Type definition ของ Cloudflare Worker bindings |
| `pnpm db:migrate` | รันสคริปต์ Migration ของ Drizzle ขึ้นฐานข้อมูล |
| `pnpm db:index` | สร้าง Performance Indexes บนตารางใน PostgreSQL |
| `pnpm db:index:dry` | ตรวจสอบคำสั่ง SQL ของ Index โดยไม่รันจริง |

---

## การ Deploy สู่ Cloudflare Workers

1. **Login เข้าสู่ Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **ตั้งค่า Secrets ทั้งหมด**:
   ```bash
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put INTERNAL_API_SECRET
   npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   npx wrangler secret put LINE_CHANNEL_SECRET
   ```

3. **รันคำสั่ง Deploy**:
   ```bash
   pnpm deploy
   ```

---

## ประสิทธิภาพและความปลอดภัย (Performance & Security)

1. **การเร่งความเร็วด้วย Cloudflare Hyperdrive (ทางเลือก)**:
   - สลับ `DB_DRIVER = "hyperdrive"` ใน `wrangler.toml` เพื่อเปิดใช้งาน Connection Pooling
   - *คำเตือนสำคัญ*: ต้องปิด Hyperdrive Query Caching ก่อน เพื่อป้องกันไม่ให้ข้อมูลที่เพิ่งอัปเดตแสดงผลล่าช้า:
     ```bash
     npx wrangler hyperdrive update <HYPERDRIVE_ID> --caching-disabled true
     ```
2. **ระบบแจ้งเตือนข้อผิดพลาดอัตโนมัติ (5xx System Alerts)**:
   - เมื่อเกิด Error 5xx ใดๆ ใน Worker ระบบจะรวบรวม Request ID, Path, และ Message ส่งแจ้งเตือนเข้าสู่กลุ่ม LINE Admin/Ops ทันที โดยมีการ Throttling เพื่อไม่ให้ส่งข้อความรบกวนมากเกินไป
3. **การป้องกัน API (Internal Shared Secret)**:
   - ป้องกันไม่ให้บุคคลภายนอกเรียก Endpoint ตรง โดยต้องมี HTTP Header `x-internal-secret` ที่ตรงกันระหว่าง Vercel และ Cloudflare Worker เสมอ

---

## แนวทางการแก้ไขปัญหา (Troubleshooting & Operations)

### 1. Database Connection Timeout หรือเชื่อมต่อไม่ได้
- **สาเหตุ**: `DATABASE_URL` ผิดพลาด หรือ Neon Endpoint อยู่ในสถานะ Suspend
- **วิธีแก้**: ตรวจสอบ Connection String ใน Cloudflare Secret และทดสอบเชื่อมต่อด้วย Neon Console

### 2. ร้องขอ API จากภายนอกแล้วตอบกลับ 401 Unauthorized
- **สาเหตุ**: คำขอไม่มี Header `x-internal-secret` หรือค่าไม่ตรงกับที่กำหนดไว้ใน Secret ของ Worker
- **วิธีแก้**: ตรวจสอบว่า Frontend Proxy มีการตั้งค่า `INTERNAL_API_SECRET` เดียวกันกับ Backend หรือไม่

### 3. บอท LINE ไม่ตอบกลับข้อความในกลุ่ม
- **สาเหตุ**:
  1. บอทยังไม่ได้ปิดฟีเจอร์ Auto-response ใน LINE Developers Console
  2. กลุ่มยังไม่ได้กดเพิ่มเพื่อนหรืออนุญาตให้บอทเข้ากลุ่ม
  3. Webhook URL ใน LINE Console ยังไม่เปิดใช้งาน (Use webhook = Enabled) หรือ URL ไม่ถูกต้อง (ต้องเป็น `https://<domain>/webhook/line`)
