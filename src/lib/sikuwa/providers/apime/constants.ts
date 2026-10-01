/**
 * Nama dan endpoint ApiMe, dipisah ke berkas sendiri.
 *
 * Alasannya sama seperti di `fonnte/constants.ts` dan `openwa/constants.ts`:
 * `ApiMeSession` dan `ApiMeShowQr` perlu menyebut nama gateway ini di dalam
 * `Session` yang mereka susun, sedangkan `ApiMe` sendiri yang mengimpor
 * keduanya. Menulis namanya di `apime.ts` akan membuat ketiganya saling
 * mengimpor dalam lingkaran.
 */

/** Nama gateway, sebagaimana ditulis di `WHATSAPP_PROVIDER` dan `WHATSAPP_TOKEN_<Provider>`. */
export const APIME_NAME = 'ApiMe';

/** Base URL instance bawaan bila pemanggil tidak menyebutkan satu pun. */
export const APIME_DEFAULT_URL = 'https://api-me.whatsapp.com';
