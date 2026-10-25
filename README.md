# 8 Sian Member — Backend

ดู [โครงสร้างไฟล์และจุดแก้ไข](docs/STRUCTURE.md) ก่อนเพิ่มหรือปรับ API

Deploy บน Droplet ด้วย PM2: ดู [คู่มือ deploy ประวัติปัญหา และการแก้ไขครั้งถัดไป](docs/DEPLOY-DROPLET.md)

Node.js Express API, PostgreSQL และ Prisma สำหรับสมัครสมาชิกด้วยเบอร์โทรและรหัสผ่าน ไม่ใช้ LINE หรือ SMS

## เริ่มใช้งาน

ต้องมี Node.js 22 ขึ้นไป และ PostgreSQL

```powershell
npm.cmd ci
# ทำเฉพาะตอนยังไม่มี .env
Copy-Item .env.example .env
```

สร้างฐานข้อมูล แล้วแก้ DATABASE_URL ใน .env ให้เป็นของคุณ และตั้ง FRONTEND_ORIGIN ให้ตรง frontend

```powershell
npm.cmd run generate
npm.cmd run migrate
npm.cmd run dev
```

ตรวจ API: http://localhost:3001/api/health

หาก generate พบ EPERM บน Windows ให้หยุด backend ก่อนสร้าง client ใหม่

## ทดสอบ

```powershell
npm.cmd test
npm.cmd exec -- prisma validate
# Integration test สร้างและลบเฉพาะข้อมูลทดสอบของตนในฐานข้อมูลที่ตั้งไว้ ใช้ port 3099
node --env-file=.env scripts/check-auth.mjs
# ทดสอบแอดมินใน schema แยกอัตโนมัติ แล้วลบ schema ทดสอบเท่านั้น ต้องมีสิทธิ์สร้าง schema
node --env-file=.env scripts/check-admin.mjs
```

## DigitalOcean App Platform

เชื่อม repository นี้ เลือก Node.js buildpack และใช้ root directory ของ repository

- Build: `npm ci && npm run generate`
- Run: `npm run migrate && npm start`
- Port: 3001
- Health check: /api/health
- Environment: DATABASE_URL (secret), FRONTEND_ORIGIN, PORT=3001, NODE_ENV=production

ใช้ Managed PostgreSQL พร้อม TLS และจำกัด trusted sources ตั้ง FRONTEND_ORIGIN เป็น HTTPS URL frontend ไม่มี slash ท้าย แนะนำโดเมนร่วมกัน เช่น member.example.com และ api.example.com เพื่อหลีกเลี่ยง browser บล็อก third-party cookies

## API

### แคมเปญต่อเนื่อง

แคมเปญกำหนด `prerequisiteCampaignId` เป็นแคมเปญก่อนหน้าได้ตอนสร้าง หากไม่กำหนดจะรับได้ตามปกติ เงื่อนไขไม่แก้ย้อนหลังผ่าน API และอ้างอิงได้เฉพาะแคมเปญที่มีอยู่แล้ว จึงสร้างลำดับรอบ 1 → 2 → 3 ต่อไปได้โดยไม่เกิดวงจรผ่านหน้าแอดมิน

สมาชิกต้องมีคูปองของแคมเปญก่อนหน้าที่ `usedAt` ถูกบันทึกสำเร็จและไม่เป็นเวลาอนาคต จึงรับ/ได้รับแจกและเปิดบาร์โค้ดแคมเปญถัดไปได้ ตรวจตามสมาชิกผู้รับจริงที่ API ทุกครั้ง การเปิดบาร์โค้ด การหมดอายุ หรือการใช้คูปองโดยสมาชิกคนอื่นไม่ปลดล็อกสิทธิ์ คูปองรอบถัดไปที่แจกไว้ก่อนเพิ่มเงื่อนไขยังคงอยู่ แต่เปิดบาร์โค้ดไม่ได้จนผ่านเงื่อนไข

Migration `202610250007_campaign_sequence` ตั้งแคมเปญเดิม “มารอบที่ 2 รับส่วนลด 20 บาท” ให้ต้องใช้ `seafood79_welcome_v1` (“เพิ่มทะเล +79”) ก่อน โดยไม่แก้ประวัติการใช้หรืออายุคูปอง และยกเลิกบาร์โค้ดเก่าของคูปองรอบถัดไปที่ยังไม่ใช้ หากพบชื่อแคมเปญรอบที่ 2 ซ้ำ migration จะหยุดเพื่อไม่ผูกผิดรายการ

Deploy backend ด้วย `npm run generate` และ `npm run migrate` ก่อนใช้งาน frontend รุ่นนี้ เมื่อ POS ยืนยันแล้วหน้าเปิดบาร์โค้ดจะโหลดสิทธิ์ใหม่ หรือสมาชิกกดอัปเดตคูปองได้ ไม่มีการเพิ่ม endpoint ให้ลูกค้าหรือแอดมินกดตั้งสถานะใช้แล้วเอง การเชื่อม POS ต้องตรวจเงื่อนไขซ้ำใน transaction ยืนยันชำระเงินด้วย

ทดสอบลำดับสามแคมเปญด้วย `npm run test:sequence` สคริปต์ใช้ PostgreSQL schema ชั่วคราวแยกจากข้อมูลใช้งานจริง และลบเฉพาะ schema ทดสอบของตัวเอง ต้องมีสิทธิ์สร้าง schema

- GET /api/health
- POST /api/auth/register: firstName, lastName, phone, birthDate (YYYY-MM-DD), password, privacyConsent, marketingConsent
- POST /api/auth/login: phone, password
- POST /api/auth/logout
- GET /api/members/me
- GET /api/campaigns แสดงแคมเปญที่เปิดรับ พร้อมสถานะว่าบัญชีนี้รับแล้วหรือยัง
- POST /api/campaigns/:id/claim สมาชิกรับคูปองได้หนึ่งครั้งต่อแคมเปญ มี rate limit
- GET /api/coupons อ่านเฉพาะคูปองของตนที่ยังไม่ใช้และไม่หมดอายุ
- POST /api/coupons/:id/barcode สร้างบาร์โค้ดสำหรับให้ POS สแกน (ยังไม่ใช้สิทธิ์)
- GET /api/coupons/:id/status ตรวจสถานะ AVAILABLE / USED / EXPIRED เฉพาะเจ้าของ
- POST /api/coupons/:id/redeem เส้นทางเดิมตอบ 410 สมาชิกไม่สามารถกดตัดสิทธิ์เองได้อีก

แอดมินสร้างและเปิดแคมเปญให้สมาชิกกดรับเองจากหน้าหลักหลัง login ได้ หรือแจกให้สมาชิกจากหลังบ้านได้เช่นกัน ไม่มีการแจกอัตโนมัติ แคมเปญตัวอย่างเพิ่มทะเล +79 บาท กินทะเลไม่อั้นมีอายุ 30 วันจากวันที่รับ/แจก แคมเปญใหม่กำหนดชื่อ รายละเอียด ค่าใช้จ่ายเพิ่ม และอายุ 1-365 วันได้ การปิดแคมเปญซ่อนจากหน้ารับและหยุดการรับ/แจกใหม่ แต่ไม่ยกเลิกคูปองเดิม

ปุ่มรับแล้วดูจากประวัติทั้งหมด รวมคูปองที่ใช้หรือหมดอายุ ป้องกันการรับซ้ำด้วย unique สมาชิก+แคมเปญร่วมกันทั้งลูกค้ารับเองและแอดมินแจกให้ การรับพร้อมกันสำเร็จได้ครั้งเดียว เก็บ audit action MEMBER_CLAIM_COUPON และจำกัด 20 คำขอรับ/IP ต่อ 15 นาที

ฐานข้อมูลบังคับ 1 สมาชิกต่อ 1 แคมเปญ แม้ใช้แล้วหรือหมดอายุก็แจกซ้ำไม่ได้ การกดใช้เปิดบาร์โค้ด CODE128-C อายุ 10 นาที (ไม่เกินอายุคูปอง) ใช้เลขสุ่ม 96 บิต ไม่บรรจุข้อมูลลูกค้า เก็บเฉพาะ SHA-256 ในฐานข้อมูล และเปิดใหม่จะยกเลิกบาร์โค้ดเก่า การเปิด/ปิดบาร์โค้ดยังไม่ตั้ง usedAt หน้าเว็บตรวจสถานะทุก 5 วินาทีและซ่อนคูปองเมื่อสถานะเปลี่ยนเป็น USED

ยังไม่มี API รับสแกน/จองคูปอง/ยืนยันจ่ายจาก POS จึงยังไม่สามารถใช้คูปองจบกระบวนการจริงในรุ่นนี้ ห้ามเพิ่ม endpoint สาธารณะที่เชื่อ paymentStatus จาก browser โดยตรง การยืนยัน PAID กับการตั้ง usedAt และยกเลิกรหัสต้องเป็น transaction เดียวที่ได้รับสิทธิ์จากระบบ POS ดูแผนใน docs/POS-PLAN.md

POST ต้องส่ง Origin ตรง FRONTEND_ORIGIN และ frontend ใช้ credentials: include รหัสผ่านเก็บเป็น scrypt hash; session อายุ 7 วันใช้ HttpOnly cookie; production ใช้ Secure cookie และ HTTPS

## ป้องกันสแปม

ข้อมูลสมัครสมาชิกตรวจซ้ำที่ API เสมอ: ชื่อและนามสกุลช่องละ 1–80 ตัวอักษร รองรับตัวอักษรหลายภาษา ช่องว่าง จุด ขีด และ apostrophe แต่ไม่รับตัวเลข โค้ด HTML หรืออักขระควบคุม เบอร์มือถือไทยต้องเป็นตัวเลข 10 หลักขึ้นต้น 06/08/09 วันเกิดต้องเป็นวันที่จริงตั้งแต่ปี 1900 ถึงวันนี้ตามเวลาไทย รหัสผ่าน 6–128 ตัวอักษรและห้ามเป็นช่องว่างทั้งหมด ต้องยอมรับนโยบายข้อมูลก่อนสมัคร ข้อจำกัดรหัสผ่านใหม่นี้ไม่เปลี่ยนเงื่อนไขการ login ของบัญชีเดิม

- สมัคร: ไม่เกิน 5 คำขอต่อ IP ใน 15 นาที
- Login: ไม่เกิน 30 คำขอต่อ IP ใน 15 นาที และลองผิดไม่เกิน 5 ครั้งต่อคู่เบอร์โทร/IP
- เมื่อเกินโควตา API ตอบ 429 พร้อม Retry-After หน้าเว็บแสดงเวลานับถอยหลัง
- ตัวนับเก็บใน memory ต่อ backend instance จะเริ่มใหม่เมื่อ restart หากขยายหลาย instance ให้ใช้ shared store เช่น Redis
- Development ไม่เชื่อ X-Forwarded-For เพื่อกันปลอม IP ส่วน production สมมติอยู่หลัง reverse proxy 1 ชั้นตาม DigitalOcean App Platform ต้องตรวจให้ตรงกับโครงสร้างจริง

หนึ่งเบอร์ใช้ได้หนึ่งบัญชี เบอร์เป็นชื่อบัญชีแต่ยังไม่ใช่หลักฐานยืนยันความเป็นเจ้าของ ไม่มีการกู้รหัสผ่านด้วยตนเอง สมาชิกติดต่อแอดมินช่วยตั้งรหัสผ่านหลังตรวจสอบตัวตน อย่ารีเซ็ตจากชื่อและวันเกิดอย่างเดียว

## หลังบ้านแอดมินคนเดียว

เปิดจาก frontend: `http://localhost:5173/control-8sian-4d9c7a2e7f`

บัญชีแอดมินแยกจากสมาชิก มี role ADMIN จากฐานข้อมูล และ CHECK constraint บังคับ id เป็น owner ทำให้มีได้เพียง 1 บัญชี ไม่มี API สมัครแอดมิน ไม่มีรหัสผ่านเริ่มต้น

หลัง migrate และ generate แล้ว สร้างครั้งแรกจากโฟลเดอร์ backend:

```powershell
node --env-file=.env scripts/create-admin.mjs
```

กำหนด username (เว้นว่างใช้ admin) และรหัสผ่าน 12-128 ตัวแบบซ่อน ยืนยันรหัสผ่าน สคริปต์ปฏิเสธหากมีแอดมินแล้ว จึงไม่เปลี่ยนบัญชีเดิมโดยไม่ตั้งใจ

หลังบ้านรองรับ:

- ค้นหาสมาชิกจากเบอร์ ชื่อ นามสกุล หรือเลขสมาชิก พร้อมแบ่งหน้า
- ดูข้อมูลสมาชิก คูปองที่รับแล้ว ใช้แล้ว หมดอายุ และวันเวลาที่เกี่ยวข้อง
- สร้างและเปิด/ปิดการแจกแคมเปญ เลือกสมาชิกเพื่อแจกคูปองทีละบัญชี พร้อมยืนยันก่อนแจก
- ตั้งรหัสผ่านใหม่ให้สมาชิก โดยยืนยันรหัสผ่านแอดมินและใส่เหตุผล สมาชิกออกจากระบบทุกอุปกรณ์ทันที
- ดูประวัติการทำรายการ โดยไม่บันทึกรหัสผ่านหรือ password hash ลง audit log

API ทุกเส้นทาง /api/admin ต้องใช้ admin session ยกเว้น login Cookie แยกจากสมาชิก อายุ 8 ชั่วโมง เป็น HttpOnly และ Secure ใน production มี rate limit สำหรับ login และ reset password และตรวจ Origin ของคำขอแก้ไขข้อมูล URL ที่เดายากไม่ใช่รหัสลับและไม่ทดแทนการตรวจสิทธิ์ ตั้ง HTTPS และเก็บรหัสผ่านแอดมินใน password manager ของคุณ

ยังไม่ได้สร้างบัญชีแอดมินจริงในฐานข้อมูลร้าน คุณเป็นผู้กำหนดรหัสผ่านเองผ่านคำสั่งข้างต้น การสำรองข้อมูลให้ใช้ backup ของ Managed PostgreSQL หรือเครื่องมือ PostgreSQL ระบบนี้ไม่เปิดให้แอดมินรัน SQL โดยตรงจากเว็บ

## ตั้งรหัสผ่านใหม่โดยผู้ดูแล

หลังตรวจสอบว่าเป็นเจ้าของบัญชีแล้ว ผู้ดูแลที่มีสิทธิ์เข้าถึงเครื่องและฐานข้อมูลสามารถรันจากโฟลเดอร์ backend:

```powershell
node --env-file=.env scripts/reset-password.mjs
```

กรอกเบอร์โทรที่สมัครไว้ รหัสผ่านใหม่ และยืนยันรหัสผ่าน ตัวอักษรรหัสผ่านจะถูกซ่อน ไม่บันทึกเป็น plaintext และ session เดิมจะถูกเพิกถอน คำสั่งนี้ทำงานเฉพาะบนเครื่อง ไม่ใช่ API สาธารณะ

เก็บ migration ทั้งหมดไว้และใช้ migrate deploy ห้าม reset ฐานข้อมูลที่มีข้อมูลจริง migration รุ่นโทรศัพท์จะหยุดหากพบเบอร์ซ้ำ สมาชิกจากรุ่น LINE ต้องตรวจสอบตัวตนก่อนตั้งรหัสผ่าน และสมาชิกเดิมเว้นวันเกิดว่างได้

## ข้อมูลที่ไม่อัปโหลด

.env และ credentials, node_modules, generated client, logs, uploads, backups และไฟล์ editor ถูก ignore เก็บเฉพาะ .env.example ที่เป็นตัวอย่าง อย่าใส่รหัสผ่าน production หรือข้อมูลสมาชิกจริงลง repository

## Git repository

Repository: https://github.com/NatthawutT-07/8-sian-member-backend

Run Git commands inside this project's directory. Production branch: main.

```sh
git add .
git commit -m "Describe your change"
git push origin main
```

Deployment uses Node.js 22 (package.json engines and .node-version).

DigitalOcean App Platform: select main, source directory `/`, enable Autodeploy. Build with `npm ci && npm run generate`; run `npm run migrate && npm start`; HTTP port 3001; health check `/api/health`. Set DATABASE_URL as a secret, FRONTEND_ORIGIN to the exact frontend HTTPS origin, NODE_ENV=production and PORT=3001. Supply these variables before the first deployment.

Reference: https://docs.digitalocean.com/products/app-platform/reference/buildpacks/nodejs/
