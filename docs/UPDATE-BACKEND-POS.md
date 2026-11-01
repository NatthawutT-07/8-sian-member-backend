# อัปเดต backend และ POS 0.4.0

POS บรรจุหน้า UI ในโปรแกรม Windows เรียก `https://api.8sianracha.com/api/pos/*` ผ่าน main process ไม่ต้องนำ POS repository หรือ `pos/web` ขึ้น server อีกต่อไป Backend `/pos/` จะตอบ 404 โดยตั้งใจ ต้องอัปเดตแอป Windows พร้อม backend รุ่นนี้ แอปรุ่นเก่าที่โหลด `/pos/` จะใช้ไม่ได้

## บน server (ผู้ใช้ deploy)

สำรองฐานข้อมูลก่อน และตรวจว่าคำสั่งสำเร็จ:

```bash
mkdir -p ~/backups
chmod 700 ~/backups
sudo -u postgres pg_dump -Fc sian_member > ~/backups/sian_member_$(date +%Y%m%d_%H%M%S).dump
cd ~/8-sian-member-backend
git status --short
git pull --ff-only origin main
nano .env
```

หากมีโค้ดแก้ค้าง ให้ตรวจสอบก่อน pull ห้าม reset ทับ ตั้งค่าเหล่านี้ใน `.env` โดยคง DATABASE_URL และค่า LINE เดิม:

```dotenv
FRONTEND_ORIGIN=https://8sianracha.com
POS_ORIGIN=https://api.8sianracha.com
NODE_ENV=production
```

ไม่ต้องเพิ่ม origin `null`, `file://` หรือ `*` และไม่ต้องเปิดพอร์ตใหม่ ใช้ HTTPS ของ API เดิม แอปส่ง origin ของ backend และใช้ session พนักงาน POS แยกจากสมาชิก/แอดมิน Origin ไม่ใช่สิทธิ์ยืนยันตัวตน

ช่วงบำรุงรักษา:

```bash
pm2 stop 8sian-backend
npm ci && npm run generate && npm run migrate && pm2 restart 8sian-backend --update-env
```

ถ้าขั้นใดผิดพลาด ให้แก้ก่อนทำต่อ ไม่ใช้ migrate reset ชุดนี้ไม่เพิ่ม schema migration ใหม่ แต่ migrate จะ apply รายการเก่าที่ยังค้างบน server

```bash
pm2 status
pm2 logs 8sian-backend --lines 50 --nostream
curl --fail-with-body http://127.0.0.1:3001/api/health
curl --fail-with-body https://api.8sianracha.com/api/health
pm2 save
```

Health ต้องตอบ `{"status":"ok"}` ไม่ต้องแก้ Nginx หาก proxy API เดิมใช้ได้อยู่แล้ว ไม่ต้อง deploy frontend สำหรับการเปลี่ยนชุดนี้

## บน Windows สำหรับ build

จาก workspace เดิม หรือโฟลเดอร์ที่ clone repository `8-sian-member-pos`:

```powershell
npm.cmd --prefix pos ci
npm.cmd --prefix pos test
npm.cmd --prefix pos run check:desktop
npm.cmd --prefix pos run build:win
```

หาก environment มี `ELECTRON_RUN_AS_NODE=1` ให้เอาออกจาก terminal นี้ก่อนรัน Electron:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

ตัวติดตั้ง Windows x64 อยู่ใน `pos/release/` ติดตั้งบนเครื่องร้าน ไม่ต้องติดตั้ง Node.js ที่เครื่องร้าน ไม่รองรับ Android/iOS

## ตั้งค่าที่เครื่องร้าน

เปิดแอปครั้งแรก โปรแกรมสร้าง `server.json` ในโฟลเดอร์ userData ของ Electron (ปกติ `%APPDATA%/8sian-pos/server.json`) โดยมีค่าเริ่มต้น:

```json
{"apiUrl":"https://api.8sianracha.com"}
```

ถ้าเคยติดตั้งรุ่นเก่า ให้ปิดแอปและแก้ไฟล์นี้ให้ตรงตัวอย่าง ค่าเก่า `url` ที่ลงท้าย `/pos/` ยังอ่านได้ แต่ localhost เดิมจะไม่เปลี่ยนเป็น production อัตโนมัติ

เปิดแอป เข้าระบบด้วยบัญชีพนักงาน USER ที่สร้างจากหน้าแอดมิน แล้วทดสอบโหลดสินค้า เปิดกะ บันทึกบิล และพิมพ์กับอุปกรณ์จริง Session อยู่ในหน่วยความจำของ main process ไม่บันทึกรหัสผ่านหรือ session ลงไฟล์ ปิดแล้วเปิดแอปใหม่ต้องเข้าสู่ระบบอีกครั้ง ยังต้องใช้อินเทอร์เน็ตเพื่อบันทึกการขาย

การอัปเดต UI POS ครั้งต่อไปต้อง build และติดตั้งโปรแกรมใหม่ ไม่ได้อัปเดตจากหน้าเว็บ server โดยอัตโนมัติ
