/**
 * Nama dan URL bawaan Waxum, dipisah ke berkas sendiri.
 *
 * Alasannya sama seperti di `apime/constants.ts` dan `openwa/constants.ts`:
 * `WaxumSession` dan `WaxumShowQr` perlu menyebut nama gateway ini di dalam
 * `Session` yang mereka susun, sedangkan `Waxum` sendiri yang mengimpor
 * keduanya. Menulis namanya di `waxum.ts` akan membuat ketiganya saling
 * mengimpor dalam lingkaran — di PHP tidak masalah (kelas diselesaikan saat
 * dipakai), di JavaScript modul dievaluasi sekali dan urutannya tidak dijamin.
 *
 * `Waxum.NAME` dan `Waxum.DEFAULT_URL` tetap ada sebagai properti statis, jadi
 * permukaan API-nya tidak berubah.
 */

/** Nama gateway, sebagaimana ditulis di `WHATSAPP_PROVIDER` dan `WHATSAPP_TOKEN_<Provider>`. */
export const WAXUM_NAME = 'Waxum';

/** Base URL instance bawaan bila pemanggil tidak menyebutkan satu pun. */
export const WAXUM_DEFAULT_URL = 'https://waxum.whatsapp.com';
