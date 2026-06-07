# Martebak26

Aplikasi web tantangan tebak skor Piala Dunia 2026.

## Jalankan lokal

```powershell
npm start
```

Default server menggunakan `PORT=8080`. Untuk produksi lokal yang dipakai tunnel Cloudflare:

```powershell
.\start-production.ps1
```

## Catatan data

File runtime seperti `data.json`, `*-table.txt`, dan log tidak disimpan di repository karena berisi data peserta, prediksi, ranking, dan aktivitas server.
