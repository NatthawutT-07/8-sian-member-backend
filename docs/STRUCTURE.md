# โครงสร้าง Backend

```text
backend/
├── src/
│   ├── server.js                 # เปิด HTTP server และปิด connection เมื่อหยุดงาน
│   ├── app.js                    # ประกอบ Express, middleware และ API ทุกหมวด
│   ├── config/env.js             # อ่าน environment และตั้งค่า cookie/origin
│   ├── db/prisma.js              # Prisma connection ของแอป
│   ├── middleware/               # ตรวจ Origin และจัดการ error กลาง
│   ├── modules/
│   │   ├── auth/                 # สมัคร/login, session, validation, rate limit
│   │   ├── members/              # API และรูปแบบข้อมูลสมาชิกที่ส่งกลับ
│   │   ├── coupons/              # แคมเปญ รับคูปอง สร้างบาร์โค้ด และสถานะ
│   │   └── admin/                # Login แอดมิน จัดการสมาชิก/คูปอง และ audit
│   └── shared/                   # Hash รหัสผ่าน/token และตัวช่วย validation
├── tests/unit/                   # ชุดทดสอบอัตโนมัติ ไม่ใช้ฐานข้อมูลจริง
├── scripts/                      # สร้างแอดมิน กู้รหัสผ่าน และ integration checks
├── prisma/
│   ├── schema.prisma             # โครงสร้างข้อมูล
│   └── migrations/               # ประวัติแก้ฐานข้อมูล ห้ามแก้ migration ที่ใช้แล้ว
├── docs/                         # เอกสารสำหรับผู้พัฒนา
├── .env.example                  # ตัวอย่าง configuration ไม่มี secret จริง
└── README.md                     # การติดตั้ง รัน ทดสอบ และ deploy
```

## จะปรับอะไร ให้เริ่มที่ไหน

| งาน | ไฟล์หลัก |
|---|---|
| เปลี่ยนเงื่อนไขข้อมูลสมัครสมาชิก | src/modules/auth/auth.validation.js |
| เปลี่ยน flow สมัคร/login | src/modules/auth/auth.routes.js |
| อ่าน ตรวจ และสร้าง session สมาชิก | src/modules/auth/member-session.service.js |
| ปรับจำนวนครั้งป้องกัน spam | src/modules/auth/auth.limits.js |
| เปลี่ยนข้อมูลสมาชิกที่ API ส่งกลับ | src/modules/members/member.presenter.js |
| รับคูปองและอ่านสถานะ | src/modules/coupons/coupons.routes.js |
| อายุและรูปแบบรหัสบาร์โค้ด | src/modules/coupons/barcode.service.js |
| สิทธิ์และ session แอดมิน | src/modules/admin/admin-auth.routes.js |
| ประกอบ API หลังบ้าน | src/modules/admin/admin.routes.js |
| ค้นหา แจกคูปอง และช่วยเหลือรหัสผ่าน | src/modules/admin/admin-members.routes.js |
| สร้างและเปิด/ปิดแคมเปญ | src/modules/admin/admin-campaigns.routes.js |
| สรุปยอดและประวัติหลังบ้าน | src/modules/admin/admin-reports.routes.js |
| ตรวจข้อมูลจากหลังบ้าน | src/modules/admin/admin.validation.js |
| เปลี่ยนฐานข้อมูล | prisma/schema.prisma แล้วสร้าง migration ใหม่ |

## แนวทางเพิ่มโค้ด

API ที่เป็นฟีเจอร์ใหม่ให้สร้างโฟลเดอร์ใน modules ตามงาน เช่น modules/pos ส่วนการตรวจข้อมูลแยกในไฟล์ .validation.js และงานที่ใช้ร่วมหลายฟีเจอร์จึงค่อยวางใน shared ไม่เพิ่ม logic ธุรกิจลง server.js

หาก module โตจนอ่านยาก ให้แยก service สำหรับกฎธุรกิจและ transaction ออกจาก routes ตามความจำเป็น โดยไม่ต้องสร้างชั้นว่างสำหรับทุก endpoint

สคริปต์ผู้ดูแลคงอยู่ scripts และอ่าน .env จาก backend ตามเดิม tests/unit ใช้ชื่อ *.test.js ส่วน integration checks รันผ่าน npm run test:integration โดยตั้งใจแยกจาก unit tests เพื่อไม่ให้แตะฐานข้อมูลโดยไม่ตั้งใจ

## คำสั่งจากโฟลเดอร์ backend

```powershell
npm.cmd run dev
npm.cmd test
npm.cmd run test:integration
npm.cmd run generate
npm.cmd run migrate
```

ไฟล์ .env, node_modules, log และข้อมูลสำรองไม่อยู่ใน Git path ของ API และ schema ฐานข้อมูลไม่ได้เปลี่ยนจากการจัดโครงสร้างครั้งนี้
