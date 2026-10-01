/**
 * Nama dan endpoint wuzapi, dipisah ke berkas sendiri.
 *
 * Alasannya sama seperti di `openwa/constants.ts` dan `apime/constants.ts`:
 * `WuzapiSession` dan `WuzapiShowQr` perlu menyebut nama gateway ini di dalam
 * `Session` yang mereka susun, sedangkan `Wuzapi` sendiri yang mengimpor
 * keduanya. Menulis namanya di `wuzapi.ts` akan membuat ketiganya saling
 * mengimpor dalam lingkaran.
 *
 * `Wuzapi.NAME` dan `Wuzapi.DEFAULT_URL` tetap ada sebagai properti statis,
 * jadi permukaan API-nya tidak berubah.
 */

/** Nama gateway, sebagaimana ditulis di `WHATSAPP_PROVIDER` dan `WHATSAPP_TOKEN_<Provider>`. */
export const WUZAPI_NAME = 'Wuzapi';

/**
 * Base URL instance bawaan bila pemanggil tidak menyebutkan satu pun.
 *
 * Nilainya disalin apa adanya dari `Wuzapi::DEFAULT_URL` di PHP, termasuk
 * domain `whatsapp.com`-nya. Terlihat mencurigakan — instance wuzapi selalu
 * self-hosted, jadi URL ini tidak akan pernah benar-benar terpakai — tetapi
 * mengubahnya berarti menyimpang dari sumbernya, dan itu justru membuat
 * perilaku kedua paket berbeda tanpa alasan.
 */
export const WUZAPI_DEFAULT_URL = 'https://wuzapi.whatsapp.com';
