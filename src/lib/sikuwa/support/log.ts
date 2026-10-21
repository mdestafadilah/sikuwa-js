/**
 * Bentuk logger yang diterima SDK.
 *
 * Ini padanan `LoggerInterface` PSR-3 versi PHP, dipersempit ke satu method:
 * SDK hanya memanggil `log()` dengan level sebagai string, dan itu yang
 * dipakai semua pustaka logger JavaScript yang lazim (`pino`, `winston`,
 * `console`). Tidak ada method `warning()`/`error()` tersendiri di sini —
 * menambahkannya berarti memaksa setiap logger buatan pemanggil menulis
 * delapan method yang tidak pernah dipanggil.
 *
 * ```ts
 * const logger = { log: (level, message, context) => console.log(level, message, context) };
 * const client = new Client({ provider: 'OpenWA', logger });
 * ```
 */
export interface LoggerLike {
  /**
   * @param level   Level PSR-3: `debug`, `info`, `warning`, atau `error`.
   * @param message Kalimat yang bisa dibaca apa adanya.
   * @param context Data tambahan, mis. `provider` dan `destination`.
   */
  log(level: string, message: string, context?: Record<string, unknown>): void;
}

/**
 * Satu-satunya jalan SDK ini menulis ke log.
 *
 * Dipakai dari dua tempat yang tidak berbagi kelas induk: jalur kirim
 * (`AbstractProvider.log()`) dan pemilihan gateway (`Client`). Aturannya cuma
 * satu, dan aturan itu terlalu berbahaya untuk disalin dua kali: **logger
 * tidak pernah boleh menggagalkan pengiriman**. Logger yang melempar — mis.
 * karena disk penuh, atau konteksnya tidak sesuai harapannya — akan mengubah
 * kegagalan hiasan menjadi kegagalan pesan.
 *
 * Selama pemanggil tidak memasang logger, tidak ada yang terjadi sama sekali.
 */
export class Log {
  static write(
    logger: LoggerLike | null | undefined,
    level: string,
    message: string,
    context: Record<string, unknown> = {},
  ): void {
    if (logger === null || logger === undefined) return;

    try {
      logger.log(level, message, context);
    } catch {
      // Sengaja ditelan — lihat penjelasan di atas.
    }
  }
}
