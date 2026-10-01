/**
 * Nama dan endpoint Wwebjs, dipisah ke berkas sendiri.
 *
 * Alasannya sama seperti di `openwa/constants.ts` dan `apime/constants.ts`:
 * `WwebjsSession` dan `WwebjsShowQr` perlu menyebut nama gateway ini di dalam
 * `Session` yang mereka susun, sedangkan `Wwebjs` sendiri yang mengimpor
 * keduanya. Menulis namanya di `wwebjs.ts` akan membuat ketiganya saling
 * mengimpor dalam lingkaran — di PHP tidak masalah (kelas diselesaikan saat
 * dipakai), di JavaScript modul dievaluasi sekali dan urutannya tidak dijamin.
 *
 * `Wwebjs.NAME` dan `Wwebjs.DEFAULT_URL` tetap ada sebagai properti statis,
 * jadi permukaan API-nya tidak berubah.
 */

/** Nama gateway, sebagaimana ditulis di `WHATSAPP_PROVIDER` dan `WHATSAPP_TOKEN_<Provider>`. */
export const WWEBJS_NAME = 'Wwebjs';

/** Base URL instance bawaan bila pemanggil tidak menyebutkan satu pun. */
export const WWEBJS_DEFAULT_URL = 'https://wwebjs.whatsapp.com';
