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
 *
 * Sebab yang sama mengubah `Client::config()` dan `Client::http()` menjadi
 * properti readonly `client.config` dan `client.http`. Di situ tidak ada nama
 * yang bergeser — yang berubah hanya bentuk pemanggilannya.
 */

export { Config, type ConfigOptions, type EnvResolver } from './config';
export { Client, type ClientOptions, type ProviderConstructor } from './client';
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

export { OpenWA } from './providers/openwa/openwa';
export { OpenWAMessage } from './providers/openwa/openwa-message';
export { OpenWABulkMessage } from './providers/openwa/openwa-bulk-message';
export { OpenWASession } from './providers/openwa/openwa-session';
export { OpenWAShowQr } from './providers/openwa/openwa-show-qr';

export { ApiMe } from './providers/apime/apime';
export { ApiMeMessage } from './providers/apime/apime-message';
export { ApiMeSession } from './providers/apime/apime-session';
export { ApiMeShowQr } from './providers/apime/apime-show-qr';

export { EvolutionAPI } from './providers/evolution-api/evolution-api';
export { EvolutionAPIMessage } from './providers/evolution-api/evolution-api-message';
export { EvolutionAPISession } from './providers/evolution-api/evolution-api-session';

export { Wuzapi } from './providers/wuzapi/wuzapi';
export { WuzapiMessage } from './providers/wuzapi/wuzapi-message';
export { WuzapiSession } from './providers/wuzapi/wuzapi-session';
export { WuzapiShowQr } from './providers/wuzapi/wuzapi-show-qr';

export { Wwebjs } from './providers/wwebjs/wwebjs';
export { WwebjsMessage } from './providers/wwebjs/wwebjs-message';
export { WwebjsSession } from './providers/wwebjs/wwebjs-session';
export { WwebjsShowQr } from './providers/wwebjs/wwebjs-show-qr';

export { Waxum } from './providers/waxum/waxum';
export { WaxumMessage } from './providers/waxum/waxum-message';
export { WaxumSession } from './providers/waxum/waxum-session';
export { WaxumShowQr } from './providers/waxum/waxum-show-qr';
