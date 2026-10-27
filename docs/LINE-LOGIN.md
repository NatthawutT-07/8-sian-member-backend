# LINE Login: ตั้งค่าและ deploy

ระบบใช้ LINE เป็นบัญชีหลัก เมื่อผ่าน LINE Login จะสร้างสมาชิกอัตโนมัติด้วย LINE user ID และชื่อ LINE แล้วเข้าหน้าคูปอง ไม่มีการกรอกชื่อ เบอร์โทร รหัสผ่าน หรือวันเกิด ชื่อ LINE อัปเดตในการเข้าใช้ครั้งถัดไปและไม่ใช้เป็นตัวระบุบัญชี

## ข้อมูล LINE Developers

- Provider: 8sianracha (`2005679414`)
- LINE Login channel: 8sianracha Member (`2012229080`)
- Linked OA: `@467rhsjz`
- Callback URL: `https://api.8sianracha.com/api/auth/line/callback`
- ใช้ Channel secret จาก **LINE Login 2012229080** ไม่ใช่ Messaging API 2012228427
- ตอนทดสอบ channel อยู่ Developing; เปิด Published หลังทดสอบแล้ว

## Backend บน DigitalOcean Droplet

ตามคู่มือ DEPLOY-DROPLET.md โค้ด backend อยู่ `/home/deploy/8-sian-member-backend` และรันผ่าน PM2 ชื่อ `8sian-backend` ตรวจ path/process จริงก่อนใช้คำสั่ง

เพิ่ม/ตรวจค่าใน `/home/deploy/8-sian-member-backend/.env` บน server:

```dotenv
NODE_ENV=production
PORT=3001
FRONTEND_ORIGIN=https://8sianracha.com
LINE_LOGIN_CHANNEL_ID=2012229080
LINE_LOGIN_CHANNEL_SECRET=ใส่_Channel_secret_ของ_LINE_Login
LINE_LOGIN_CALLBACK_URL=https://api.8sianracha.com/api/auth/line/callback
```

คง DATABASE_URL เดิมไว้ ไม่เปลี่ยนรหัสฐานข้อมูล ไม่ส่ง secret ในแชตหรือ Git ค่า LINE ต้องครบทั้งสาม หากว่างทั้งหมดระบบจะบอกว่า LINE ยังไม่พร้อม หากตั้งไม่ครบ backend จะหยุดพร้อมแจ้งชื่อค่าที่ขาด `.env` บนเครื่อง Windows กับบน server เป็นคนละไฟล์

หลัง push backend commit และสำรองฐานข้อมูลแล้ว รันใน backend repository บน Droplet:

```sh
cd /home/deploy/8-sian-member-backend
git pull --ff-only origin main
npm ci
npm run generate
npm run migrate
pm2 restart 8sian-backend --update-env
```

PM2 ต้องเริ่มโปรเซสด้วย `--env-file=/home/deploy/8-sian-member-backend/.env` ตามคู่มือเดิม เพราะ `npm start` ไม่ได้โหลดไฟล์ .env เอง หากใช้ runtime environment จาก hosting อยู่แล้ว ให้ตั้งค่าที่ hosting แทน

มี migration ใหม่สองรายการ:

1. `202610270001_line_login`: เบอร์โทรไม่บังคับ, เพิ่ม LINE user ID และตาราง OAuth flow
2. `202610270002_line_auto_member`: เพิ่มชื่อ LINE และตัวเลือกเชื่อมบัญชีเก่า

ไม่ reset ฐานข้อมูล ไม่ลบสมาชิก/คูปอง ไม่แก้ migration เก่า คำสั่งนี้ยังไม่ได้รันกับ production โดยการแก้โค้ดในเครื่อง

ตรวจ `https://api.8sianracha.com/api/health` ต้องได้ `{"status":"ok"}` และ `/api/auth/line/status` ต้องได้ `{"enabled":true}`

## Frontend บน Cloudflare Pages

ตั้ง Production environment variable:

```dotenv
VITE_API_URL=https://api.8sianracha.com
```

คง VITE_ADMIN_PATH เดิมไว้ ห้ามใส่ LINE secret ในตัวแปร VITE_* ถ้า build จาก frontend repository โดยตรง ใช้ `npm ci && npm run build` และ output `dist` หาก build จาก workspace แม่ ใช้ output `frontend/dist` ต้อง rebuild/redeploy เมื่อแก้ตัวแปร Vite

Deploy backend และ migration ก่อน frontend เพื่อไม่ให้ปุ่ม LINE เรียก endpoint ที่ยังไม่มี

## หลัง deploy

- `/register` และ `/login` เป็นหน้า LINE Login เดียวกัน ไม่มีฟอร์มสมัคร
- ตั้งปุ่ม Rich Menu ใน OA ให้เปิด `https://8sianracha.com/login`
- เมื่อ `/privacy` แสดงนโยบายใหม่จริงแล้ว ใส่ `https://8sianracha.com/privacy` ใน Basic settings → Privacy policy URL ของ LINE Login
- ทดสอบครั้งแรกต้องเข้าคูปองทันที ใช้ชื่อ LINE และไม่มีเบอร์โทร
- ออกจากระบบแล้วเข้าใหม่ต้องเป็นเลขสมาชิกเดิม ลองเปลี่ยนชื่อ LINE แล้วเข้าใหม่เพื่อทดสอบการอัปเดตชื่อ
- ผู้มีคูปองในบัญชีเบอร์โทรเดิมให้เลือก “เชื่อมสมาชิกเดิม” **ก่อนเข้าใช้ LINE ครั้งแรก** แล้วจึงยืนยันรหัสผ่านเดิม ระบบรักษาเลขสมาชิกและคูปองเดิม หากสร้างสมาชิก LINE แยกแล้วให้ติดต่อร้าน ไม่มีการรวมบัญชีอัตโนมัติ
- ทดสอบกับบัญชีที่มี role ใน channel ก่อนเปลี่ยน Developing เป็น Published แล้วทดสอบกับบัญชีลูกค้าทั่วไป
- ทดสอบ Chrome/Safari และเบราว์เซอร์ใน LINE

## การตรวจสอบ

ทดสอบ `npm test` ครอบคลุม state/cookie, callback ซ้ำ, หมดอายุ, token ไม่ถูกต้อง, nonce/audience/issuer, PKCE, สร้างสมาชิกอัตโนมัติและเข้าใช้ซ้ำ, และการผูกบัญชีเดิมด้วยรหัสผ่าน ตัวทดสอบ HTTP ใช้ repository จำลอง ไม่แตะ production database และไม่แทนการทดสอบ LINE จริง

OAuth flow เก็บใน PostgreSQL อายุ 10 นาที ใช้ได้ครั้งเดียว คุกกี้เป็น HttpOnly/Secure ใน production ใช้ state, nonce และ PKCE S256 ตรวจ ID token กับ LINE ไม่รับ user ID ที่ frontend ส่งเอง ไม่เก็บ access/refresh/ID token ลงฐานข้อมูล สมาชิกใช้ session cookie เดิม ไม่มี token ใน URL หลัง callback

ถ้า Prisma generate บน Windows แจ้ง EPERM ที่ query_engine-windows.dll.node ให้หยุดเฉพาะ backend dev server ที่ใช้ client นี้ก่อน generate ใหม่ ไม่ต้อง reset ฐานข้อมูล
