# คู่มือ Deploy และแก้ปัญหา Backend บน DigitalOcean Droplet

บันทึกวันที่ 26 ตุลาคม 2569 (2026-10-26) สำหรับกลับมาตรวจสอบและใช้อัปเดตระบบครั้งถัดไป

คู่มือนี้ใช้ **Ubuntu 24.04 + Node.js 22 + PostgreSQL + PM2 + Nginx + HTTPS** ไม่ใช่ DigitalOcean App Platform คำสั่ง Linux ทั้งหมดรันบน Droplet ส่วนโค้ด Nginx และตัวอย่าง `.env` ต้องใส่ในไฟล์ ไม่ใช่พิมพ์เป็นคำสั่งใน terminal

## 1. ข้อมูลระบบ

| รายการ | ค่า |
|---|---|
| Droplet | `ubuntu-s-1vcpu-2gb-sgp1` |
| ระบบปฏิบัติการ | Ubuntu 24.04 LTS x64 |
| Public IP | `168.144.134.249` |
| API domain | `api.8sianracha.com` |
| ผู้ใช้รันแอป | `deploy` |
| Backend directory | `/home/deploy/8-sian-member-backend` |
| Git repository | https://github.com/NatthawutT-07/8-sian-member-backend.git |
| Branch | `main` |
| PM2 process name | `8sian-backend` |
| API port ภายในเครื่อง | `3001` |
| PostgreSQL host/port | `127.0.0.1:5432` |
| Database / role ที่เลือกใช้ | `sian_member` / `member_app` |
| Frontend origin | ต้องกรอก URL frontend จริง ยังไม่มี URL ที่ยืนยันในบันทึกนี้ |

ไม่มีรหัสผ่านหรือ token จริงในคู่มือนี้ รหัสฐานข้อมูล รหัส Ubuntu และรหัสแอดมินเว็บไซต์เป็นคนละบัญชีกัน

## 2. สิ่งที่ทราบจากการ deploy รอบนี้

สถานะต่อไปนี้อ้างอิง output ที่ผู้ดูแลส่งมา ยังไม่ใช่การตรวจ server โดยตรงจากผู้เขียนคู่มือ

| เหตุการณ์ | สิ่งที่ยืนยันได้ / การแก้ไข |
|---|---|
| `usermod -aG sudo deploy` | รันแล้วโดย root ตาม log |
| UFW เป็น `active` และอนุญาต `OpenSSH`, `Nginx Full` ทั้ง IPv4/IPv6 | ขั้นตอน firewall ผ่านแล้วตาม log |
| DNS A record ของ `api.8sianracha.com` ชี้ `168.144.134.249` | ในภาพเป็น Proxied; แนะนำให้เปลี่ยนเป็น DNS only แต่ยังไม่มีผลยืนยันหลังเปลี่ยน |
| `prisma generate` สำเร็จ รุ่น 6.19.0 | สร้าง client ได้ แต่ไม่ได้แปลว่าเข้า database ได้ |
| `migrate` แจ้ง P1000 สำหรับ `member` แล้วภายหลังเป็น `member_app` | ค่า username/password ใน URL ยังยืนยันตัวตนไม่ผ่านในขณะนั้น |
| `psql` ภายหลังแจ้ง `database "sian_member" does not exist` | ครั้งนั้นผ่านขั้น authentication แล้ว แต่ยังไม่มี database ชื่อนี้ ต้องสร้าง database |
| รัน `server_name ...;` และ `proxy_pass ...;` แล้ว `command not found` | เป็น directive ที่ต้องใส่ในไฟล์ Nginx ไม่ใช่ shell command |
| `/snap/bin/certbot: command not found` | ยังไม่มี executable ตาม path นี้ ต้องติดตั้ง Certbot หรือตรวจการติดตั้ง |

**ยังไม่มี output ยืนยัน** ว่าสร้าง `sian_member` สำเร็จ, migrations ผ่าน, PM2 online, Nginx test ผ่าน หรือ HTTPS ใช้งานได้ ให้ใช้รายการตรวจท้ายเอกสารยืนยันทีละข้อก่อนถือว่า deploy สำเร็จ

## 3. เข้า server และติดตั้งเครื่องมือ

จาก PowerShell บน Windows:

```powershell
ssh deploy@168.144.134.249
```

หากยังเข้า `deploy` ผ่าน SSH ไม่ได้ ใช้ Web Console หรือบัญชี root ที่เข้าได้ก่อน ต้องมีบัญชี `deploy` แล้วจึงรัน `su - deploy` ไม่ต้องปิด root SSH ระหว่างที่ยังทดสอบบัญชีใหม่ไม่ผ่าน

บน Droplet ด้วยผู้ใช้ที่มี sudo:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates nginx postgresql postgresql-contrib ufw snapd
sudo systemctl enable --now postgresql nginx
```

ติดตั้ง Node.js 22 หากยังไม่มี (หาก `node -v` เป็น v22 อยู่แล้วให้ข้าม):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node -v
npm -v
```

ติดตั้ง PM2 ครั้งแรก:

```bash
sudo npm install -g pm2
```

ต่อจากนี้รัน `git`, `npm` และ `pm2` ด้วยผู้ใช้ `deploy` ไม่ใช้ `sudo pm2` เพราะจะกลายเป็นรายการ process คนละชุดของ root

## 4. Firewall และ DNS

ตรวจ UFW ที่เคยตั้งไว้:

```bash
sudo ufw status
```

หากยังไม่ตั้ง ให้อนุญาต SSH ก่อนเปิด firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

หากผูก DigitalOcean Cloud Firewall ด้วย ต้องอนุญาต TCP 22, 80, 443 ที่ firewall นั้นเช่นกัน จำกัดพอร์ต SSH ให้ IP ผู้ดูแลได้ ไม่เปิด 3001 หรือ 5432 สู่สาธารณะ แอปปัจจุบัน listen ที่ `0.0.0.0` จึงต้องคง firewall ป้องกันพอร์ตเหล่านี้

DNS บน Cloudflare:

```text
Type: A
Name: api
IPv4: 168.144.134.249
Proxy status: DNS only (เมฆสีเทา)
```

คู่มือนี้กำหนดให้มี proxy หนึ่งชั้นคือ Nginx ซึ่งตรงกับ `trustProxy: 1` ใน production อย่าเปิด Cloudflare Proxy เพิ่มโดยไม่ตรวจการอ่าน client IP และ rate limit ใหม่

ตรวจ DNS จากเครื่องที่มี `dig`:

```bash
dig +short api.8sianracha.com A
```

เมื่อเป็น DNS only ควรได้ IP Droplet หากไม่มี `dig` ใช้ `getent ahostsv4 api.8sianracha.com` ได้

## 5. สร้าง role และ database

หากเป็นการติดตั้งใหม่และยังไม่มี role:

```bash
sudo -u postgres createuser --pwprompt member_app
```

กรอกรหัสผ่านใหม่สองครั้ง จอไม่แสดงตัวอักษรขณะพิมพ์เป็นปกติ หากแจ้งว่า role มีแล้ว ให้เปลี่ยนรหัสแทน ไม่ต้องลบ role:

```bash
sudo -u postgres psql
```

ภายใน psql:

```text
\password member_app
\q
```

สร้าง database หากยังไม่มี:

```bash
sudo -u postgres createdb --owner=member_app sian_member
```

หากแจ้งว่ามี database อยู่แล้ว ให้ตรวจเจ้าของและข้อมูลก่อน ไม่ลบหรือสร้างทับ:

```bash
sudo -u postgres psql -c '\l sian_member'
```

ทดสอบรหัสผ่านจริงผ่าน TCP:

```bash
psql -h 127.0.0.1 -U member_app -d sian_member -W
```

ต้องเห็น prompt `sian_member=>` แล้วพิมพ์ `\q` เพื่อออก ขั้นตอนนี้ต้องผ่านก่อนแก้ปัญหาที่ Prisma

## 6. Clone repository และตั้งค่า .env

หากยังไม่เคย clone:

```bash
cd ~
git clone https://github.com/NatthawutT-07/8-sian-member-backend.git
cd ~/8-sian-member-backend
npm ci
```

หากมีโฟลเดอร์แล้ว ไม่ clone ซ้ำ ใช้ขั้นตอนอัปเดตในหัวข้อ 11 สำหรับ repository private ให้ใช้ SSH deploy key แบบ read-only หรือช่องทางยืนยัน GitHub ที่เหมาะสม ไม่ฝัง token ใน URL ของ repository

สร้าง `.env` เฉพาะเมื่อยังไม่มี:

```bash
cd ~/8-sian-member-backend
test -f .env || cp .env.example .env
chmod 600 .env
nano .env
```

**ข้อความต่อไปนี้ใส่ในไฟล์ `.env`** เปลี่ยนค่าตัวอย่างก่อนใช้งาน:

```dotenv
DATABASE_URL="postgresql://member_app:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/sian_member?schema=public"
PORT=3001
FRONTEND_ORIGIN=https://YOUR_FRONTEND_DOMAIN
NODE_ENV=production
```

- รหัสใน `DATABASE_URL` ต้องตรงกับที่ตั้งให้ `member_app` และ URL-encode เฉพาะส่วนรหัส เช่น `@` → `%40`, `#` → `%23`, `%` → `%25` ตอน psql ถามรหัสให้กรอกรหัสจริง ไม่ใช่ค่าที่ encode
- `FRONTEND_ORIGIN` เป็น URL frontend จริง ไม่ใช่ API domain ไม่มี slash ท้ายหรือ path เช่น `https://member.8sianracha.com` เป็นเพียงตัวอย่างหากคุณยังไม่ได้ตั้งโดเมนนี้
- `.env` บน server กับ `backend/.env` บน Windows เป็นคนละไฟล์ การแก้ใน IDE ไม่ได้เปลี่ยนค่าบน server
- บันทึก nano ด้วย Ctrl+O → Enter → Ctrl+X ห้าม commit `.env`

สร้าง client และตาราง:

```bash
npm run generate && npm run migrate
npx prisma migrate status
```

`generate` ไม่ตรวจว่ารหัสฐานข้อมูลถูกต้อง ต้องให้ `migrate` ผ่านด้วย ห้ามใช้ `prisma migrate reset` หรือ `db push --force-reset` กับฐานข้อมูลใช้งานจริง

ฐานข้อมูลใหม่ไม่รับข้อมูลสมาชิก/แคมเปญจาก Windows อัตโนมัติ Migration มีแคมเปญแรก “เพิ่มทะเล +79” แต่แคมเปญรอบที่ 2 ที่สร้างจากหลังบ้านเดิมไม่ได้ถูกคัดลอกมาด้วย หากไม่มีใน server ให้สร้างผ่านหน้าแอดมินและเลือกแคมเปญแรกเป็นเงื่อนไขก่อนหน้า หากต้องการย้ายข้อมูลเดิม ต้องวางแผน backup/restore ต่างหาก

## 7. เปิดแอปด้วย PM2

หากเคยตั้ง systemd service ชื่อเดียวกัน ให้ตรวจและหยุดเฉพาะ service เดิมก่อนใช้ PM2 เพื่อไม่ให้พอร์ตชน:

```bash
sudo systemctl status 8sian-backend --no-pager
```

หาก service มีอยู่และใช้งานอยู่จริง:

```bash
sudo systemctl disable --now 8sian-backend
```

เริ่ม PM2 ด้วยบัญชี `deploy` หากยังไม่มี process นี้:

```bash
cd ~/8-sian-member-backend
pm2 start src/server.js --name 8sian-backend --node-args="--env-file=/home/deploy/8-sian-member-backend/.env"
pm2 status
pm2 logs 8sian-backend --lines 50
```

Ctrl+C ออกจากการดู log โดยไม่หยุดแอป ต้องมี `--env-file` เพราะ `npm start` ของโปรเจกต์รัน `node src/server.js` และไม่ได้โหลด `.env` ให้เอง หากมี process นี้อยู่แล้ว ใช้ `pm2 restart 8sian-backend --update-env` แทนการ start ซ้ำ

ตรวจ backend และ database:

```bash
curl --fail-with-body http://127.0.0.1:3001/api/health
```

ผลที่ต้องได้: `{"status":"ok"}`

ตั้งให้กลับมาหลัง reboot:

```bash
pm2 startup
```

คัดลอกคำสั่ง `sudo ...` ที่ PM2 แสดงมารันให้ครบ แล้วบันทึกรายการแอป:

```bash
pm2 save
```

คำสั่งใช้งานประจำ:

```bash
pm2 status
pm2 describe 8sian-backend
pm2 logs 8sian-backend --lines 100
pm2 restart 8sian-backend --update-env
```

PM2 log โตได้เรื่อย ๆ ควรตั้ง retention เช่นติดตั้ง module `pm2-logrotate` ใต้บัญชี deploy:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 save
```

## 8. ตั้ง Nginx

คำสั่งเปิดไฟล์:

```bash
sudo nano /etc/nginx/sites-available/8sian-backend
```

**วางข้อความนี้ใน nano ไม่รันเป็น shell command:**

```nginx
server {
    listen 80;
    server_name api.8sianracha.com;

    client_max_body_size 16k;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

เปิดใช้ครั้งแรก:

```bash
sudo ln -s /etc/nginx/sites-available/8sian-backend /etc/nginx/sites-enabled/8sian-backend
sudo nginx -t
```

ถ้า `ln` แจ้ง `File exists` ให้ตรวจ link ก่อน ไม่ต้องลบไฟล์อื่น:

```bash
ls -l /etc/nginx/sites-enabled/8sian-backend
```

เมื่อ `nginx -t` ขึ้น `syntax is ok` และ `test is successful` เท่านั้น จึง reload:

```bash
sudo systemctl reload nginx
curl --fail-with-body -H 'Host: api.8sianracha.com' http://127.0.0.1/api/health
```

หากเคยออก HTTPS แล้ว ห้ามวาง config HTTP ข้างบนทับทั้งไฟล์ เพราะจะลบค่าที่ Certbot เพิ่มไว้ ให้แก้เฉพาะส่วนที่ต้องปรับและตรวจ `nginx -t` เสมอ

## 9. ติดตั้ง HTTPS และเชื่อม frontend

DNS ต้องชี้ IP ถูกต้องและพอร์ต 80/443 เข้าได้ก่อน:

```bash
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d api.8sianracha.com
sudo /snap/bin/certbot renew --dry-run
curl --fail-with-body https://api.8sianracha.com/api/health
```

ทำตามคำถามเรื่องอีเมลและเงื่อนไขใน Certbot แล้วตรวจ HTTPS ให้ได้ `{"status":"ok"}`

Cloudflare Pages frontend ต้องตั้ง build variable:

```dotenv
VITE_API_URL=https://api.8sianracha.com
```

ไม่เติม `/api` ท้ายค่า และ deploy frontend ใหม่หลังเปลี่ยน variable ส่วน backend ตั้ง `FRONTEND_ORIGIN` ให้ตรงโดเมน frontend ที่ลูกค้าเปิดจริง หากใช้โดเมน custom ร่วมกัน เช่น `member.8sianracha.com` และ `api.8sianracha.com` จะลดปัญหาการบล็อก third-party cookies เมื่อเทียบกับการใช้ `pages.dev` ข้ามโดเมน

หลังแก้ `.env` บน server:

```bash
pm2 restart 8sian-backend --update-env
```

## 10. สร้างแอดมินและทดสอบการใช้งาน

สร้างบัญชีแอดมินครั้งแรกเท่านั้น ไม่มีรหัสผ่านเริ่มต้น:

```bash
cd ~/8-sian-member-backend
node --env-file=.env scripts/create-admin.mjs
```

ทดสอบผ่านเว็บไซต์จริง:

1. `/register` สมัครด้วยบัญชีที่ผู้ดูแลเตรียมไว้ทดสอบ
2. `/login` เข้าระบบแล้วไป `/coupons`
3. Refresh แล้วยังมี session; logout แล้วกลับหน้าแรก
4. หลังบ้านเข้าด้วยบัญชีแอดมินได้ และสมาชิกทั่วไปเข้า API แอดมินไม่ได้
5. แคมเปญต่อเนื่องยังล็อกจนคูปองก่อนหน้ามี `usedAt` ยืนยันจากระบบที่เชื่อถือได้

การเปิดบาร์โค้ดไม่ใช่การใช้คูปองสำเร็จ รุ่นนี้ยังไม่มี endpoint เชื่อม POS ยืนยันชำระเงินครบกระบวนการ อย่าตั้ง `usedAt` ของลูกค้าจริงเพียงเพื่อทดสอบการปลดล็อก

## 11. อัปเดต backend จาก GitHub ครั้งถัดไป

นี่เป็นการ deploy ด้วยตนเอง `git push` จาก Windows ไม่ได้ทำให้ Droplet pull เอง

ตรวจ commit และการแก้ไขบน server ก่อน:

```bash
cd ~/8-sian-member-backend
git status --short
git rev-parse --short HEAD
pm2 status
```

หากมีไฟล์โค้ดแก้ค้าง ให้เก็บและพิจารณาการแก้ไขก่อน pull ไม่ใช้ `git reset --hard` หรือ `git clean` เพื่อกลบปัญหา จด commit ปัจจุบันไว้ในบันทึกท้ายเอกสาร

สำรอง database ก่อน โดยเฉพาะรอบที่มี migration:

```bash
mkdir -p ~/backups
chmod 700 ~/backups
umask 077
backup_file="$HOME/backups/sian_member-$(date -u +%Y%m%dT%H%M%SZ).dump"
sudo -u postgres pg_dump -Fc sian_member > "$backup_file"
test -s "$backup_file"
pg_restore --list "$backup_file"
```

ตรวจว่าแต่ละคำสั่งสำเร็จ โดย `pg_restore --list` ช่วยตรวจสารบัญ archive แต่ยังไม่ใช่การทดสอบ restore จริง ควรมีสำเนา backup เข้ารหัสนอก Droplet และทดสอบ restore ในฐานข้อมูลแยกตามรอบด้วย

ดึงโค้ด หากคำสั่ง pull ล้มเหลวให้หยุดตรวจสาเหตุก่อน:

```bash
git pull --ff-only origin main
```

เมื่อ pull สำเร็จ ใช้ช่วงบำรุงรักษาเพื่อหยุดแอปก่อนเปลี่ยน dependencies/schema:

```bash
pm2 stop 8sian-backend
npm ci && npm run generate && npm run migrate && pm2 restart 8sian-backend --update-env
```

ถ้าคำสั่งใดล้มเหลว แอปอาจยังหยุดอยู่ ให้ดู error และแก้ก่อน restart ไม่รัน reset database การใช้ `&&` จะไม่เริ่มขั้นถัดไปเมื่อขั้นก่อนหน้าไม่ผ่าน

ตรวจหลังอัปเดต:

```bash
pm2 status
curl --fail-with-body http://127.0.0.1:3001/api/health
curl --fail-with-body https://api.8sianracha.com/api/health
git rev-parse --short HEAD
```

ตรวจ login และหน้าคูปองอีกครั้งก่อนปิดงาน `health` ผ่านยืนยันการเชื่อม database แต่ไม่ได้ทดสอบทุกฟังก์ชัน

หากรอบนั้นแก้ frontend ด้วย ต้อง deploy frontend repository แยก และให้ backend/schema ที่รองรับพร้อมก่อนเปิดใช้ฟังก์ชันใหม่

## 12. ตารางแก้ปัญหา

| อาการ | ตรวจและแก้ |
|---|---|
| Prisma P1000 | ทดสอบ `psql -h 127.0.0.1 -U member_app -d sian_member -W`; ถ้า psql ผ่านแต่ Prisma ไม่ผ่าน ให้ตรวจ `.env` บน server และ URL-encoding ของรหัส |
| `database "sian_member" does not exist` | สร้างด้วย `sudo -u postgres createdb --owner=member_app sian_member` เฉพาะเมื่อยังไม่มี |
| `role "member_app" does not exist` | สร้าง role ตามหัวข้อ 5 ก่อน แล้วตั้งรหัส |
| P1010 / permission denied for schema public | ตรวจ `sudo -u postgres psql -c '\l sian_member'` ว่า owner เป็น member_app หรือไม่ อย่าให้ SUPERUSER เพื่อแก้ลัด ตรวจสิทธิ์ database/schema ก่อนปรับ |
| P1001 / connection refused ที่ 5432 | ตรวจ `sudo systemctl status postgresql --no-pager` และ `sudo ss -ltnp` |
| `server_name` / `proxy_pass: command not found` | ใส่ directive ในไฟล์ Nginx ตามหัวข้อ 8 |
| `/snap/bin/certbot: command not found` | ตรวจ `snap list certbot` และติดตั้งด้วย `sudo snap install --classic certbot` |
| Certbot timeout / validation failed | ตรวจ DNS, DNS only, firewall ทั้ง UFW/Cloud Firewall และพอร์ต 80; ตรวจ `sudo nginx -t` |
| Nginx 502 | ตรวจ health ที่ 127.0.0.1:3001 และ PM2 logs ก่อน ถ้าภายในใช้ไม่ได้ให้แก้ backend ไม่ใช่ DNS |
| Nginx default page / 404 | ตรวจ server_name, enabled symlink และ domain ที่เปิด ตรวจ `sudo nginx -t` ว่ามีชื่อ host ซ้ำหรือไม่ |
| `EADDRINUSE` พอร์ต 3001 | ตรวจ `sudo ss -ltnp '( sport = :3001 )'` และ `pm2 status`; หยุดเฉพาะ service/process เดิมที่ยืนยันแล้ว อย่าฆ่า Node ทุกตัว |
| PM2 แสดงรายการว่าง | ตรวจ `whoami`; ต้องเป็น deploy ไม่ใช่ root ใช้ `pm2 status` โดยไม่ sudo |
| PM2 online แต่ health 503 | อ่าน `pm2 logs 8sian-backend --lines 100`; health นี้ทดสอบ query database ด้วย |
| Login ตอบ 403 | ตรวจ FRONTEND_ORIGIN ต้องตรง browser Origin ทั้ง https และ hostname แล้ว restart PM2 |
| Login สำเร็จแต่เปิดหน้าใหม่หลุด | ตรวจ HTTPS, cookie ใน browser, โดเมน frontend/backend และการบล็อก third-party cookies |
| แก้ VITE_API_URL แล้วเว็บยังเรียก API เดิม | ต้อง build/deploy frontend ใหม่ |
| แคมเปญรอบถัดไปตอบ 403 / ยังไม่ปลดล็อก | ตรวจสมาชิกคนเดียวกันและประวัติใช้คูปองก่อนหน้า `usedAt`; การเปิด QR/บาร์โค้ดหรือหมดอายุไม่ปลดล็อก |
| Backend ใหม่แจ้ง column ไม่พบ | ตรวจ `npm run migrate` และ `npx prisma migrate status` บน database ที่ `.env` ชี้จริง |
| git pull แจ้ง divergent/local changes | เก็บ output และตรวจ commit/ไฟล์ที่แก้ก่อน ไม่ force pull |

## 13. เมื่ออัปเดตผิดพลาด / ย้อนรุ่น

1. เก็บ error log, commit ก่อน/หลัง และชื่อ migration ที่รันไปแล้ว
2. หากเปลี่ยนเฉพาะโค้ดและยืนยันว่า schema ยังรองรับรุ่นก่อน อาจ checkout commit ก่อนหน้าในช่วงบำรุงรักษา แล้วติดตั้ง dependencies, generate และ restart ใหม่ตามขั้นตอน deploy
3. การย้อน Git ไม่ย้อน database migration ต้องตรวจความเข้ากันได้ก่อน ไม่ลบ migration ที่ apply แล้วและไม่ใช้ reset กับข้อมูลจริง
4. หากต้อง restore ให้ทดสอบ backup ใน database ใหม่ก่อน การ restore ทับฐานข้อมูลจริงอาจทำข้อมูลหลังเวลา backup หาย จึงต้องมีแผนและยืนยันขอบเขตต่างหาก

## 14. รายการยืนยันก่อนถือว่า deploy สำเร็จ

- [ ] `node -v` เป็น 22.x และรันแอปด้วย deploy
- [ ] psql เข้า `sian_member` ด้วย member_app ได้
- [ ] `.env` บน server เป็นค่าจริงและ permission 600
- [ ] `npm run migrate` ผ่าน และไม่มี pending/failed migration
- [ ] PM2 process online; ตั้ง startup และ save แล้ว
- [ ] health ภายในและ HTTPS ได้ `{"status":"ok"}`
- [ ] DNS only และ Nginx config ผ่าน nginx -t
- [ ] Certbot renew --dry-run ผ่าน
- [ ] Frontend เรียก API domain จริงและ login/refresh/logout ได้
- [ ] มีแอดมินที่ผู้ดูแลกำหนดรหัสเอง
- [ ] ตรวจแคมเปญใน server แล้ว ไม่สมมติว่าข้อมูลจากเครื่องพัฒนาถูกย้ายมาด้วย
- [ ] ตั้งแผน backup นอกเครื่องและ retention log

## 15. แบบบันทึกการเปลี่ยนแปลงครั้งถัดไป

คัดลอกแบบฟอร์มนี้เพิ่มเมื่อมีการ deploy หรือ incident ไม่ใส่รหัสผ่าน, cookie, token หรือข้อมูลส่วนบุคคลลูกค้าลงบันทึก

```text
วันเวลา (Asia/Bangkok):
ผู้ดำเนินการ:
ปัญหา/เหตุผลที่อัปเดต:
Commit ก่อน:
Commit หลัง:
Database/schema เป้าหมาย:
Backup ที่ใช้และผลตรวจ:
Migration ที่เพิ่ม/ผลรัน:
ไฟล์ config ที่แก้ (ไม่ใส่ค่า secret):
คำสั่งที่รัน:
Error ที่พบ (ตัดข้อมูลลับออก):
การแก้ไข:
ผล health ภายใน / HTTPS:
ผลทดสอบ login / coupons / logout:
สถานะสุดท้าย / งานค้าง:
```

## เอกสารอ้างอิง

- [NodeSource Node.js 22](https://nodesource.com/blog/Nodejs-v22-jod-binaries-distribution)
- [PostgreSQL createuser](https://www.postgresql.org/docs/current/app-createuser.html)
- [PostgreSQL createdb](https://www.postgresql.org/docs/current/app-createdb.html)
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)
- [PM2 startup](https://pm2.keymetrics.io/docs/usage/startup/)
- [PM2 logs และ log rotation](https://pm2.keymetrics.io/docs/usage/log-management/)
- [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Certbot สำหรับ Nginx](https://certbot.eff.org/instructions?os=snap&ws=nginx)
- [DigitalOcean UFW](https://www.digitalocean.com/community/tutorials/how-to-set-up-a-firewall-with-ufw-on-ubuntu)
