# 🚀 Panduan Lengkap Setup Proxy di Oracle Cloud (Step-by-Step)

## Daftar Isi
1. [Signup Oracle Cloud](#1-signup-oracle-cloud)
2. [Buat VPS (Compute Instance)](#2-buat-vps-compute-instance)
3. [Setup Static IP](#3-setup-static-ip)
4. [Buka Port 3000 (Firewall)](#4-buka-port-3000-firewall)
5. [SSH ke VPS](#5-ssh-ke-vps)
6. [Upload & Jalankan Proxy](#6-upload--jalankan-proxy)
7. [Test Proxy](#7-test-proxy)
8. [Whitelist IP di Exchange](#8-whitelist-ip-di-exchange)
9. [Configure Vercel](#9-configure-vercel)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Signup Oracle Cloud

### 1.1 Buat Akun
1. Buka: **https://cloud.oracle.com/**
2. Klik **"Start for free"** atau **"Sign up"**
3. Isi data:
   - **Name, Email, Password**
   - **Country**: pilih negara kamu (Indonesia bisa)
   - **Address**: isi alamat asli (akan diverifikasi)

### 1.2 Verifikasi
1. Cek email → klik link verifikasi
2. **Login** kembali
3. Isi **Company name** (boleh nama sendiri)
4. Isi **Phone number** → akan dikirim SMS/OTP

### 1.3 Verifikasi Kartu Kredit/Debit
Oracle membutuhkan kartu untuk verifikasi identitas (tidak akan dikenakan biaya untuk free tier).

**Kartu yang bisa dipakai:**
- ✅ Visa/Mastercard Credit
- ✅ Visa/Mastercard Debit
- ✅ Virtual card (Jenius, Flazz BCA, dll) — *kadang bisa*

> ⚠️ **Tips**: Kalau kartu ditolak, coba pakai kartu kredit. Pastikan ada saldo minimal $1 untuk verifikasi.

### 1.4 Pilih Home Region
Pilih region terdekat:
- **Singapore** (ap-southeast-1) ← **Recommended** (latensi rendah ke Indonesia)
- Tokyo (ap-northeast-1)
- Sydney (ap-southeast-2)

> ⚠️ **PENTING**: Region ini **tidak bisa diubah** setelah dipilih! Pilih Singapore.

### 1.5 Tunggu Approval
- Biasanya **instan** atau maksimal 15 menit
- Kalau lebih dari 1 jam, cek email spam

---

## 2. Buat VPS (Compute Instance)

### 2.1 Buka Console
1. Login: **https://cloud.oracle.com/**
2. Klik menu ☰ (hamburger) di kiri atas
3. Pilih **"Compute"** → **"Instances"**
4. Pastikan **Compartment** = `root` (atah yang ada)

### 2.2 Create Instance
1. Klik **"Create Instance"**
2. Isi konfigurasi:

| Setting | Value |
|---------|-------|
| **Name** | `copytrade-proxy` |
| **Compartment** | `root` (default) |
| **Image** | Click "Change" → pilih **Canonical Ubuntu 22.04** → Minimal → ARM |
| **Shape** | Click "Change" → pilih **Ampere A1** (Free tier eligible) |
| **Boot volume size** | Default (47 GB) |
| **SSH Keys** | Pilih **"Generate a key pair for me"** → Klik **Save Private Key** → Simpan file `.key` |

### 2.3 Klik Create
- Tunggu ~2-5 menit sampai status **Running** (hijau)

> 💡 **Kalau error "Out of Capacity"**: ARM instance sering penuh. Coba:
> - Refresh halaman dan coba lagi
> - Ganti Availability Domain (AD-2 atau AD-3)
> - Tunggu beberapa jam dan coba lagi

---

## 3. Setup Static IP

### 3.1 Reserve Public IP
1. Di halaman Instance, klik nama instance `copytrade-proxy`
2. Scroll ke bawah → bagian **"Resources"** → klik **"Attached VNICs"**
3. Klik nama VNIC (biasanya ada 1)
4. Scroll ke bawah → bagian **"Resources"** → klik **"IPv4 Addresses"**
5. Klik **"Edit"**
6. Pilih **"Reserved public IP"** → klik **"Allocate"**
7. Copy **Public IP** yang muncul (format: `xxx.xxx.xxx.xxx`)
8. Klik **"Update"**

> ✅ IP ini **statis** — tidak akan berubah sampai kamu release

---

## 4. Buka Port 3000 (Firewall)

Oracle Cloud punya **2 layer firewall** — keduanya harus dibuka!

### 4.1 Security List (Oracle Cloud Firewall)
1. Klik menu ☰ → **Networking** → **Virtual Cloud Networks**
2. Klik VNIC yang sama dengan instance kamu
3. Scroll ke **"Subnets"** → klik subnet yang ada
4. Scroll ke **"Security Lists"** → klik security list
5. Klik **"Add Ingress Rules"**
6. Isi:
   - **Source Type**: CIDR
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: TCP
   - **Source Port Range**: (kosongkan)
   - **Destination Port Range**: `3000`
7. Klik **"Add Ingress Rules"**

### 4.2 Network Security Group (Opsional)
Kalau instance kamu pakai NSG:
1. Klik menu ☰ → Networking → **Network Security Groups**
2. Klik NSG yang terkait
3. Klik **Add Rule** → Ingress → TCP → Port 3000 → Source 0.0.0.0/0

---

## 5. SSH ke VPS

### 5.1 Dari Terminal (Mac/Linux)

```bash
# Set permission private key
chmod 600 ~/Downloads/<nama-file-key>.key

# SSH ke VPS
ssh -i ~/Downloads/<nama-file-key>.key ubuntu@<PUBLIC_IP>
```

### 5.2 Dari Windows (PowerShell)
```powershell
ssh -i C:\Users\<username>\Downloads\<nama-file-key>.key ubuntu@<PUBLIC_IP>
```

### 5.3 Dari PuTTY (Windows)
1. Download PuTTYgen
2. Load `.key` file → Save as `.ppk`
3. Buka PuTTY → Connection → SSH → Auth → browse `.ppk`
4. Session → Host: `ubuntu@<PUBLIC_IP>` → Open

> 💡 **Default user**: `ubuntu` untuk Ubuntu image

---

## 6. Upload & Jalankan Proxy

### 6.1 Upload File ke VPS

**Dari terminal lokal** (bukan di SSH VPS), jalankan:

```bash
# Upload seluruh folder proxy/
scp -i ~/Downloads/<nama-file-key>.key -r /path/to/copytrade/proxy/ ubuntu@<PUBLIC_IP>:~/proxy/
```

Ganti:
- `<nama-file-key>` → nama file key yang didownload dari Oracle
- `/path/to/copytrade/proxy/` → path ke folder proxy di komputer kamu
- `<PUBLIC_IP>` → IP statis VPS kamu

### 6.2 SSH ke VPS & Jalankan Setup

```bash
# Masuk ke VPS
ssh -i ~/Downloads/<nama-file-key>.key ubuntu@<PUBLIC_IP>

# Masuk ke folder proxy
cd ~/proxy

# Jalankan setup script
bash setup.sh
```

Setup script akan otomatis:
- ✅ Install Node.js 20.x
- ✅ Install PM2 (process manager)
- ✅ Install dependencies
- ✅ Buka port 3000 di iptables
- ✅ Start proxy sebagai service
- ✅ Auto-restart saat VPS reboot

### 6.3 Configure .env (Opsional tapi Recommended)

```bash
cd ~/proxy
cp .env.example .env
nano .env
```

Set minimal:
```
API_SECRET=your_random_secret_here
```

> 💡 Generate random secret: `openssl rand -hex 32`

---

## 7. Test Proxy

### 7.1 Test dari VPS (lokal)
```bash
curl http://localhost:3000/okx/api/v5/public/time
```

Expected response:
```json
{"code":"0","msg":"","data":["2024-01-01T00:00:00.000Z"]}
```

### 7.2 Test dari Komputer Kamu
```bash
curl http://<PUBLIC_IP>:3000/okx/api/v5/public/time
```

Kalau ini berhasil → proxy sudah benar-benar berjalan! 🎉

### 7.3 Test MEXC
```bash
curl http://<PUBLIC_IP>:3000/mexc/api/v1/contract/ticker/BTCUSDT
```

---

## 8. Whitelist IP di Exchange

### 8.1 OKX
1. Login ke **https://www.okx.com/**
2. Avatar → **API** → pilih API key kamu
3. **Edit** → **IP Restrictions**
4. Tambahkan `<PUBLIC_IP>` VPS kamu
5. Save

### 8.2 MEXC
1. Login ke **https://www.mexc.com/**
2. Avatar → **API Management**
3. Pilih API key → **IP Access**
4. Tambahkan `<PUBLIC_IP>` VPS kamu
5. Save

---

## 9. Configure Vercel

### 9.1 Set Environment Variables

1. Buka **https://vercel.com/** → project kamu
2. **Settings** → **Environment Variables**
3. Tambahkan:

| Variable | Value |
|----------|-------|
| `OKX_PROXY_URL` | `http://<PUBLIC_IP>:3000/okx` |
| `MEXC_PROXY_URL` | `http://<PUBLIC_IP>:3000/mexc` |

4. Klik **Save**
5. **Redeploy** project kamu

### 9.2 Verifikasi

Setelah redeploy, cek Vercel function logs:
- Buka Vercel → project → **Logs**
- Trigger signal check
- Pastikan tidak ada error koneksi ke proxy

---

## 10. Troubleshooting

### ❌ Tidak bisa SSH
```bash
# Cek apakah instance running di Oracle Console
# Pastikan pakai user yang benar: ubuntu@
# Pastikan permission key: chmod 600 key.key
# Cek Security List: port 22 harus terbuka
```

### ❌ curl dari luar tidak bisa (Connection refused)
```bash
# 1. Cek proxy berjalan:
ssh ubuntu@<IP> "pm2 status"

# 2. Cek port 3000 di iptables:
ssh ubuntu@<IP> "sudo iptables -L -n | grep 3000"

# 3. Cek Oracle Security List (step 4.1)

# 4. Cek proxy listen di 0.0.0.0 (bukan 127.0.0.1):
ssh ubuntu@<IP> "curl http://localhost:3000/okx/api/v5/public/time"
```

### ❌ Proxy jalan tapi OKX return error
```bash
# Cek log proxy:
ssh ubuntu@<IP> "pm2 logs copytrade-proxy"

# Test langsung dari VPS ke OKX:
ssh ubuntu@<IP> "curl https://www.okx.com/api/v5/public/time"
```

### ❌ Vercel error: ETIMEDOUT / ECONNREFUSED
```bash
# Test dari luar:
curl http://<PUBLIC_IP>:3000/okx/api/v5/public/time

# Kalau timeout → firewall Oracle belum benar (step 4)
# Kalau connection refused → proxy tidak jalan (step 6)
```

### ❌ OKX error: IP not allowed
```
# Pastikan whitelist IP di OKX sudah benar
# Pastikan IP yang di-whitelist = Public IP VPS (bukan private IP)
# Cek IP VPS: curl ifconfig.me (dari dalam VPS)
```

### 🔄 Restart Proxy
```bash
ssh ubuntu@<PUBLIC_IP>
pm2 restart copytrade-proxy
pm2 logs copytrade-proxy --lines 50
```

### 🔄 Update Proxy
```bash
# Dari terminal lokal, upload ulang:
scp -i ~/Downloads/<key>.key -r /path/to/proxy/ ubuntu@<IP>:~/proxy/

# Dari SSH VPS:
ssh ubuntu@<IP>
cd ~/proxy
npm install --production
pm2 restart copytrade-proxy
```

---

## 📋 Checklist

- [ ] Akun Oracle Cloud aktif
- [ ] VPS ARM instance running
- [ ] Static IP (Reserved Public IP) assigned
- [ ] Port 22 & 3000 open di Security List
- [ ] SSH berhasil
- [ ] Proxy files uploaded
- [ ] `bash setup.sh` berhasil
- [ ] `curl localhost:3000/okx/api/v5/public/time` → OK
- [ ] `curl <PUBLIC_IP>:3000/okx/api/v5/public/time` → OK
- [ ] Static IP di-whitelist di OKX
- [ ] Static IP di-whitelist di MEXC
- [ ] `OKX_PROXY_URL` set di Vercel
- [ ] `MEXC_PROXY_URL` set di Vercel
- [ ] Vercel redeployed
- [ ] Signal check berjalan tanpa error

---

## 💰 Biaya

| Item | Biaya |
|------|-------|
| Oracle Cloud Free Tier | **Rp 0** (free forever) |
| VPS ARM (4 core, 24GB RAM) | **Rp 0** (included) |
| Static IP (Reserved) | **Rp 0** (included) |
| Bandwidth (10TB/month) | **Rp 0** (included) |
| Domain (opsional) | Rp 0 (pakai IP langsung) |

**Total: GRATIS selamanya** 🎉
