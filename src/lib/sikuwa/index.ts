/**
 * SIKUWA untuk JavaScript/TypeScript — porting dari paket PHP
 * `mdestafadilah/sikuwa` (namespace `Sikuwa\Whatsapp`).
 *
 * Pustaka ini sengaja tidak punya dependensi runtime: seluruh provider hanya
 * melakukan panggilan HTTP/JSON ke REST gateway, jadi `fetch` bawaan Node, Bun,
 * Cloudflare Workers, dan peramban sudah cukup.
 *
 * Nama kunci environment dipertahankan persis seperti versi PHP
 * (`WHATSAPP_TOKEN`, `WHATSAPP_PACING_CYCLE`, `WHATSAPP_TYPING`, …), supaya
 * berkas `.env` yang sudah ada tetap terbaca tanpa perubahan.
 *
 * Dua perbedaan yang disengaja terhadap versi PHP:
 *
 * 1. **Semua panggilan jaringan mengembalikan `Promise`.** PHP menunggu di
 *    dalam pemanggilan; JavaScript tidak bisa.
 * 2. **`File.bytes()` mengembalikan `Uint8Array`**, bukan string biner —
 *    bentuk yang memang diminta `Blob`/`FormData` di jalur unggah.
 *
 * Satu nama yang terpaksa berubah: accessor konfigurasi provider bernama
 * `settings()`, bukan `config()`. PHP membedakan properti `$this->config` dari
 * method `$this->config()`; JavaScript tidak bisa, dan properti `config`
 * dipertahankan apa adanya karena tiap provider membacanya jauh lebih sering.
 */

export { Config, type ConfigOptions, type EnvResolver } from './config';
export { Session, type SessionOptions } from './session';

export {
  ApiException,
  AuthException,
  ConfigurationException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  RateLimitException,
  ServiceUnavailableException,
  TimeoutException,
  UnknownProviderException,
  WhatsappException,
} from './exceptions';

export { Pacing, type PacingSpec } from './support/pacing';
export { Throttle, type ThrottleSpec } from './support/throttle';
export { Typing, type TypingSpec } from './support/typing';
export { Presence } from './support/presence';
export { PhoneNumber } from './support/phone-number';
export { Text } from './support/text';
export { File } from './support/file';
export { Qr } from './support/qr';
export { Envelope, isPlainObject, type JsonObject } from './support/envelope';

export { HttpResponse, type JsonBody } from './http/http-response';
export {
  HttpExecutor,
  type FetchLike,
  type MultipartPart,
} from './http/http-executor';

export type {
  MessageEnvelope,
  MessageInput,
  OutgoingMessage,
  TypingRequest,
  Whatsapp,
} from './contracts/whatsapp';

export {
  AbstractProvider,
  type PlannedMessage,
  type PreparedMessage,
  type Sleeper,
} from './providers/abstract-provider';

export { Fonnte } from './providers/fonnte/fonnte';
export { FonnteMessage, type FonnteLine } from './providers/fonnte/fonnte-message';
export { FonnteBulkMessage } from './providers/fonnte/fonnte-bulk-message';
export { FonnteSession } from './providers/fonnte/fonnte-session';
export { FonnteShowQr } from './providers/fonnte/fonnte-show-qr';
