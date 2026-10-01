/**
 * Nama dan endpoint OpenWA, dipisah ke berkas sendiri.
 *
 * `OpenWASession` dan `OpenWAShowQr` perlu menyebut nama gateway ini di dalam
 * `Session` yang mereka susun, sedangkan `OpenWA` sendiri yang mengimpor
 * keduanya. Kalau namanya ditulis di `openwa.ts`, ketiganya saling mengimpor
 * dalam lingkaran — di PHP tidak masalah (kelas diselesaikan saat dipakai),
 * di JavaScript modul dievaluasi sekali dan urutannya tidak dijamin.
 *
 * `OpenWA.NAME` dan `OpenWA.DEFAULT_URL` tetap ada sebagai properti statis,
 * jadi permukaan API-nya tidak berubah.
 */

/** Nama gateway, sebagaimana ditulis di `WHATSAPP_PROVIDER` dan `WHATSAPP_TOKEN_<Provider>`. */
export const OPENWA_NAME = 'OpenWA';

/** Base URL instance bawaan bila pemanggil tidak menyebutkan satu pun. */
export const OPENWA_DEFAULT_URL = 'https://openwa.whatsapp.com';
