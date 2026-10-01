/**
 * Nama dan endpoint Fonnte, dipisah ke berkas sendiri.
 *
 * `FonnteSession` dan `FonnteShowQr` perlu menyebut nama gateway ini di dalam
 * `Session` yang mereka susun, sedangkan `Fonnte` sendiri yang mengimpor
 * keduanya. Kalau namanya ditulis di `fonnte.ts`, ketiganya saling mengimpor
 * dalam lingkaran — di PHP tidak masalah (kelas diselesaikan saat dipakai),
 * di JavaScript modul dievaluasi sekali dan urutannya tidak dijamin.
 *
 * `Fonnte.NAME` dan `Fonnte.DEFAULT_URL` tetap ada sebagai properti statis,
 * jadi permukaan API-nya tidak berubah.
 */

/** Nama gateway, sebagaimana ditulis di `WHATSAPP_PROVIDER` dan `WHATSAPP_TOKEN_<Provider>`. */
export const FONNTE_NAME = 'Fonnte';

/**
 * Endpoint pengiriman bawaan.
 *
 * Fonnte adalah layanan pihak ketiga dengan satu host tetap — itulah sebabnya
 * `WHATSAPP_URL` sengaja tidak pernah dibaca provider ini.
 */
export const FONNTE_DEFAULT_URL = 'https://api.fonnte.com/send';
