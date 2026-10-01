/**
 * Kelas dasar untuk setiap error yang dilempar SDK ini.
 *
 * Menangkap kelas ini berarti menangkap semuanya — termasuk kegagalan
 * konfigurasi, kegagalan transport, dan penolakan dari gateway.
 */
export class WhatsappException extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WhatsappException';
  }
}

/**
 * Konfigurasi belum lengkap atau tidak konsisten — token kosong, URL tidak
 * valid, session/instance belum diisi, atau bentuk pesan salah.
 *
 * Kegagalan jenis ini tidak akan sembuh kalau diulang, jadi jangan diretry.
 */
export class ConfigurationException extends WhatsappException {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigurationException';
  }
}

/** Nama gateway tidak dikenali. */
export class UnknownProviderException extends ConfigurationException {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UnknownProviderException';
  }

  static forName(name: string, known: readonly string[]): UnknownProviderException {
    return new UnknownProviderException(
      `Provider "${name}" tidak dikenali. Yang tersedia: ${known.join(', ')}.`,
    );
  }
}

/** Request melewati batas waktu, baik saat menyambung maupun menunggu balasan. */
export class TimeoutException extends WhatsappException {
  readonly timeout: number;

  constructor(timeout: number, detail?: string | null) {
    super(
      detail === null || detail === undefined || detail === ''
        ? `Request melewati batas waktu ${timeout} detik`
        : `Request melewati batas waktu ${timeout} detik: ${detail}`,
    );
    this.name = 'TimeoutException';
    this.timeout = timeout;
  }

  getTimeout(): number {
    return this.timeout;
  }
}

/**
 * Gateway menjawab, tapi menolak pesannya.
 *
 * Membawa status HTTP dan body hasil decode, jadi pemanggil bisa memeriksa
 * detailnya tanpa harus mengurai ulang pesan exception. Pakai subclass bernama
 * untuk status yang umum, atau bercabang pada {@link getStatus}.
 *
 * Perlu dicatat: beberapa gateway membalas HTTP 200 walau pesannya gagal
 * (Fonnte memakai `status`, wuzapi memakai `success`). Kegagalan seperti itu
 * tetap dilaporkan sebagai ApiException, dengan status dari amplop body.
 */
export class ApiException extends WhatsappException {
  private readonly status: number;
  private readonly body: unknown;
  private readonly errorKind: string | null;
  /**
   * Detik yang diminta gateway lewat header `Retry-After`, bila ada. Disimpan
   * di kelas dasar, bukan hanya di {@link RateLimitException}, karena 503 juga
   * sering menyertakannya — dan `withRetry()` di AbstractProvider perlu
   * membacanya dari kedua status itu.
   */
  private readonly retryAfter: number | null;

  constructor(
    message: string,
    status: number,
    body: unknown = null,
    errorKind: string | null = null,
    cause: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message, cause === null || cause === undefined ? undefined : { cause });
    this.name = 'ApiException';
    this.status = status;
    this.body = body;
    this.errorKind = errorKind;
    this.retryAfter = retryAfter;
  }

  getStatus(): number {
    return this.status;
  }

  getBody(): unknown {
    return this.body;
  }

  /** Penanda jenis error dari gateway, bila ada (mis. `error` pada amplop). */
  getErrorKind(): string | null {
    return this.errorKind;
  }

  /**
   * Detik yang diminta gateway sebelum percobaan berikutnya.
   *
   * Null berarti gateway tidak mengirim `Retry-After` — pemanggil yang harus
   * memutuskan jedanya sendiri, karena menebak terlalu cepat hanya akan
   * menabrak dinding yang sama lagi.
   */
  getRetryAfter(): number | null {
    return this.retryAfter;
  }

  /** Bangun subclass paling spesifik untuk sebuah status HTTP. */
  static classify(
    status: number,
    message: string,
    body: unknown = null,
    errorKind: string | null = null,
    cause: unknown = null,
    retryAfter: number | null = null,
  ): ApiException {
    const args = [message, status, body, errorKind, cause, retryAfter] as const;

    switch (status) {
      case 401:
        return new AuthException(...args);
      case 403:
        return new ForbiddenException(...args);
      case 404:
        return new NotFoundException(...args);
      case 409:
        return new ConflictException(...args);
      case 429:
        return new RateLimitException(...args);
      case 503:
        return new ServiceUnavailableException(...args);
      default:
        return new ApiException(...args);
    }
  }
}

/** HTTP 401 — token salah, kosong, atau sudah tidak berlaku. */
export class AuthException extends ApiException {
  constructor(
    message: string,
    status: number,
    body: unknown = null,
    errorKind: string | null = null,
    cause: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message, status, body, errorKind, cause, retryAfter);
    this.name = 'AuthException';
  }
}

/** HTTP 403 — token dikenali, tetapi tidak berhak memakai endpoint itu. */
export class ForbiddenException extends ApiException {
  constructor(
    message: string,
    status: number,
    body: unknown = null,
    errorKind: string | null = null,
    cause: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message, status, body, errorKind, cause, retryAfter);
    this.name = 'ForbiddenException';
  }
}

/** HTTP 404 — sesi, instance, atau endpoint-nya tidak ada. */
export class NotFoundException extends ApiException {
  constructor(
    message: string,
    status: number,
    body: unknown = null,
    errorKind: string | null = null,
    cause: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message, status, body, errorKind, cause, retryAfter);
    this.name = 'NotFoundException';
  }
}

/** HTTP 409 — bentrok keadaan, mis. sesi dengan nama itu sudah ada. */
export class ConflictException extends ApiException {
  constructor(
    message: string,
    status: number,
    body: unknown = null,
    errorKind: string | null = null,
    cause: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message, status, body, errorKind, cause, retryAfter);
    this.name = 'ConflictException';
  }
}

/**
 * HTTP 429 — kena batas laju gateway. Satu-satunya status yang aman diretry.
 *
 * `Retry-After` dari gateway dibawa oleh {@link ApiException.getRetryAfter}
 * di kelas dasar, karena 503 juga sering menyertakannya.
 *
 * SDK memakai nilai itu untuk mencoba ulang sendiri di dalam satu batch
 * (`withRetry()` pada AbstractProvider), tetapi exception ini tetap dilempar
 * bila percobaan ulangnya gagal — jadi pemanggil yang menangani batch besar
 * tetap bisa membaca `getRetryAfter()` dan mengatur jadwalnya sendiri.
 */
export class RateLimitException extends ApiException {
  constructor(
    message: string,
    status: number,
    body: unknown = null,
    errorKind: string | null = null,
    cause: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message, status, body, errorKind, cause, retryAfter);
    this.name = 'RateLimitException';
  }
}

/**
 * HTTP 503 — sesi WhatsApp belum siap, jadi tidak ada pesan yang terkirim.
 *
 * Aman diretry setelah sesi tersambung kembali.
 */
export class ServiceUnavailableException extends ApiException {
  constructor(
    message: string,
    status: number,
    body: unknown = null,
    errorKind: string | null = null,
    cause: unknown = null,
    retryAfter: number | null = null,
  ) {
    super(message, status, body, errorKind, cause, retryAfter);
    this.name = 'ServiceUnavailableException';
  }
}
