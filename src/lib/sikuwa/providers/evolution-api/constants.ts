/**
 * Nama dan endpoint Evolution API, dipisah ke berkas sendiri.
 *
 * Alasannya sama seperti di `fonnte/constants.ts`, `openwa/constants.ts`, dan
 * `apime/constants.ts`: `EvolutionAPISession` perlu menyebut nama gateway ini di
 * dalam `Session` yang ia susun, sedangkan `EvolutionAPI` sendiri yang
 * mengimpor kelas itu. Menulis namanya di `evolution-api.ts` akan membuat
 * keduanya saling mengimpor dalam lingkaran — di PHP tidak masalah (kelas
 * diselesaikan saat dipakai), di JavaScript modul dievaluasi sekali dan
 * urutannya tidak dijamin.
 *
 * `EvolutionAPI.NAME` dan `EvolutionAPI.DEFAULT_URL` tetap ada sebagai properti
 * statis, jadi permukaan API-nya tidak berubah.
 */

/** Nama gateway, sebagaimana ditulis di `WHATSAPP_PROVIDER` dan `WHATSAPP_TOKEN_<Provider>`. */
export const EVOLUTION_API_NAME = 'EvolutionAPI';

/** Base URL instance bawaan bila pemanggil tidak menyebutkan satu pun. */
export const EVOLUTION_API_DEFAULT_URL = 'https://evolution-api.whatsapp.com';
