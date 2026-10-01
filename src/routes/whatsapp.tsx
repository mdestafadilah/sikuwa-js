import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Gauge,
  KeyRound,
  Paperclip,
  Phone,
  Send,
  Timer,
  Type,
} from "lucide-react";
import {
  whatsappService,
  type MediaResult,
  type PacingPreview,
  type PhoneResult,
  type PlanResult,
  type PresenceResult,
  type ThrottlePreview,
  type TypingPreview,
} from "@/services/whatsappService";

export const Route = createFileRoute("/whatsapp")({
  component: WhatsappPlayground,
});

const INPUT =
  "bg-black/20 border border-white/10 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500/50 transition-colors w-full";
const BUTTON =
  "bg-emerald-500 text-black px-4 py-2.5 rounded-lg font-bold hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";

/** Ubah "12, 60, 150" menjadi `[12, 60, 150]`. */
function parseLengths(text: string): number[] {
  return text
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 12);
}

/**
 * Ubah tiap baris "nomor | pesan" menjadi objek pesan.
 *
 * Segmen terakhir dianggap jeda **hanya bila isinya angka**. Tanpa aturan itu,
 * tanda "|" yang kebetulan ada di dalam isi pesan akan salah dibaca sebagai
 * jeda. Bila jeda memang tidak disebut, kuncinya sengaja tidak dipasang sama
 * sekali — itu membuat SDK memakai aturan pacing, sedangkan `0` berarti
 * "jangan tunggu". Dua hal berbeda yang mudah tertukar.
 */
function parseMessages(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, 20)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const destination = parts.shift() ?? "";

      let delay: number | undefined;
      const tail = parts[parts.length - 1] ?? "";

      if (parts.length > 1 && /^-?\d+(?:\.\d+)?$/.test(tail)) {
        delay = Number(parts.pop());
      }

      return {
        destination,
        message: parts.join(" | "),
        ...(delay === undefined ? {} : { delay }),
      };
    });
}

function Card({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    // `min-w-0` wajib: kartu ini adalah butir grid, dan butir grid bawaannya
    // `min-width: auto` — tidak boleh menyusut di bawah lebar min-content
    // isinya. Isi seperti payload JSON satu baris panjang lalu mendorong
    // seluruh halaman melebar, bukan menggulir di dalam kotaknya sendiri.
    <section className="min-w-0 p-6 rounded-2xl border border-white/10 bg-white/5">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-emerald-500/20 rounded-lg border border-emerald-500/30">
          {icon}
        </div>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
      </div>
      <p className="text-zinc-400 text-sm mb-5 leading-relaxed">{description}</p>
      {children}
    </section>
  );
}

function Kv({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-white/5 last:border-0">
      <span className="text-zinc-400 text-sm">{label}</span>
      <span className="text-emerald-400 font-mono text-sm text-right break-all">{value}</span>
    </div>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <p className="mt-4 flex items-start gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

/** Tampilkan `null` sebagai "tanpa aturan" — beda dari `0` yang berarti nol detik. */
const seconds = (value: number | null): string =>
  value === null ? "tanpa aturan" : `${value} detik`;

function ConfigCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["whatsapp", "config"],
    queryFn: whatsappService.getConfig,
  });

  return (
    <Card
      icon={<KeyRound className="w-5 h-5 text-emerald-400" />}
      title="Konfigurasi efektif"
      description="Dibaca dari environment yang sama dengan versi PHP. Kredensial disamarkan sebelum meninggalkan server."
    >
      {isLoading && <p className="text-zinc-400 text-sm">Membaca konfigurasi…</p>}
      {error && <Failure message={(error as Error).message} />}

      {data && (
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <Kv label="Gateway" value={data.provider} />
            <Kv label="Token" value={data.token} />
            <Kv label="URL" value={data.url || "(bawaan gateway)"} />
            <Kv label="Session" value={data.session || "(kosong)"} />
            <Kv label="Instance" value={data.instance || "(kosong)"} />
            <Kv label="Timeout" value={`${data.timeout} detik`} />
            <Kv label="Percobaan ulang" value={data.percobaanUlang} />
            <Kv label="Notifikasi" value={data.notifikasiAktif ? "aktif" : "mati"} />
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
              Token per gateway
            </p>
            <ul className="space-y-1 mb-5">
              {data.gateway.map((gateway) => (
                <li
                  key={gateway.nama}
                  className="flex items-center justify-between text-sm py-1.5 border-b border-white/5 last:border-0"
                >
                  <span className="text-zinc-300 font-mono">{gateway.nama}</span>
                  <span
                    className={
                      gateway.tokenTerisi
                        ? "text-emerald-400 text-xs font-semibold"
                        : "text-zinc-600 text-xs"
                    }
                  >
                    {gateway.tokenTerisi ? "token terisi" : "belum diisi"}
                  </span>
                </li>
              ))}
            </ul>

            <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
              Fitur pengaman
            </p>
            <Kv label="Pacing" value={data.pacing.aktif ? "aktif" : "mati"} />
            <Kv label="Typing" value={data.typing.aktif ? "aktif" : "mati"} />
            <Kv
              label="Throttle"
              value={
                data.throttle.aktif
                  ? `${data.throttle.max} pesan / ${data.throttle.window} detik`
                  : "mati"
              }
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function PacingCard() {
  const [cycle, setCycle] = useState("0,30");
  const [interval, setInterval] = useState("20-30");
  const [lengths, setLengths] = useState("12, 60, 150, 400");
  const preview = useMutation({ mutationFn: whatsappService.previewPacing });

  const run = () =>
    preview.mutate({
      pacing: { cycle, interval },
      lengths: parseLengths(lengths),
    });

  const result: PacingPreview | undefined = preview.data;

  return (
    <Card
      icon={<Timer className="w-5 h-5 text-emerald-400" />}
      title="Pratinjau pacing"
      description="Jeda antar pesan saat mengirim beruntun. Siklus bergiliran ditambah jitter acak, lalu dikali pengali bila pesannya panjang."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-zinc-400">
          Siklus
          <input className={INPUT} value={cycle} onChange={(e) => setCycle(e.target.value)} />
        </label>
        <label className="text-sm text-zinc-400">
          Interval acak
          <input
            className={INPUT}
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          />
        </label>
        <label className="text-sm text-zinc-400">
          Panjang pesan (karakter)
          <input
            className={INPUT}
            value={lengths}
            onChange={(e) => setLengths(e.target.value)}
          />
        </label>
      </div>

      <button className={`${BUTTON} mt-4`} onClick={run} disabled={preview.isPending}>
        {preview.isPending ? "Menghitung…" : "Hitung jeda"}
      </button>

      {preview.error && <Failure message={(preview.error as Error).message} />}

      {result && (
        <div className="mt-5">
          <Kv label="Siklus" value={`[${result.siklus.join(", ")}]`} />
          <Kv
            label="Interval"
            value={result.interval ? `${result.interval.min}–${result.interval.max}` : "tidak ada"}
          />
          <Kv
            label="Ambang pesan panjang"
            value={`${result.ambangPesanPanjang} karakter × ${result.pengaliPesanPanjang}`}
          />

          <table className="w-full mt-4 text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase tracking-wide">
                <th className="text-left py-2">Pesan ke-</th>
                <th className="text-right py-2">Panjang</th>
                <th className="text-right py-2">Jeda</th>
              </tr>
            </thead>
            <tbody>
              {result.jeda.map((item) => (
                <tr key={item.urutan} className="border-t border-white/5">
                  <td className="py-2 text-zinc-300">{item.urutan + 1}</td>
                  <td className="py-2 text-right text-zinc-400 font-mono">{item.panjang}</td>
                  <td className="py-2 text-right text-emerald-400 font-mono">
                    {seconds(item.detik)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TypingCard() {
  const [lengths, setLengths] = useState("12, 60, 150, 300, 5000");
  const preview = useMutation({ mutationFn: whatsappService.previewTyping });

  const result: TypingPreview | undefined = preview.data;

  return (
    <Card
      icon={<Type className="w-5 h-5 text-emerald-400" />}
      title="Pratinjau indikator mengetik"
      description="Lama indikator “sedang mengetik” dihitung dari panjang pesan dibagi kecepatan ketik, lalu dijepit di antara batas terpendek dan terpanjang."
    >
      <label className="text-sm text-zinc-400">
        Panjang pesan (karakter)
        <input
          className={INPUT}
          value={lengths}
          onChange={(e) => setLengths(e.target.value)}
        />
      </label>

      <button
        className={`${BUTTON} mt-4`}
        onClick={() => preview.mutate({ lengths: parseLengths(lengths) })}
        disabled={preview.isPending}
      >
        {preview.isPending ? "Menghitung…" : "Hitung durasi"}
      </button>

      {preview.error && <Failure message={(preview.error as Error).message} />}

      {result && (
        <div className="mt-5">
          <Kv label="Aktif" value={result.aktif ? "ya" : "tidak"} />
          <Kv label="Kecepatan" value={`${result.kecepatan} karakter/detik`} />
          <Kv label="Rentang" value={`${result.min}–${result.max} detik`} />

          <table className="w-full mt-4 text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase tracking-wide">
                <th className="text-left py-2">Panjang</th>
                <th className="text-right py-2">Indikator tampil</th>
              </tr>
            </thead>
            <tbody>
              {result.durasi.map((item) => (
                <tr key={item.panjang} className="border-t border-white/5">
                  <td className="py-2 text-zinc-400 font-mono">{item.panjang}</td>
                  <td className="py-2 text-right text-emerald-400 font-mono">
                    {seconds(item.detik)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ThrottleCard() {
  const [max, setMax] = useState("2");
  const [window, setWindow] = useState("30");
  const [count, setCount] = useState("6");
  const preview = useMutation({ mutationFn: whatsappService.previewThrottle });

  const result: ThrottlePreview | undefined = preview.data;

  return (
    <Card
      icon={<Gauge className="w-5 h-5 text-emerald-400" />}
      title="Pratinjau pembatas laju"
      description="Berapa pesan boleh keluar per jendela waktu. Pengirim ditahan sebelum pesan dikirim, bukan ditolak — supaya pemanggil tidak perlu menulis loop coba-ulang sendiri."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-zinc-400">
          Maksimum pesan
          <input className={INPUT} value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        <label className="text-sm text-zinc-400">
          Jendela (detik)
          <input
            className={INPUT}
            value={window}
            onChange={(e) => setWindow(e.target.value)}
          />
        </label>
        <label className="text-sm text-zinc-400">
          Jumlah pesan
          <input className={INPUT} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
      </div>

      <button
        className={`${BUTTON} mt-4`}
        onClick={() =>
          preview.mutate({
            throttle: { max: Number(max), window: Number(window) },
            count: Number(count),
          })
        }
        disabled={preview.isPending}
      >
        {preview.isPending ? "Menghitung…" : "Susun jadwal"}
      </button>

      {preview.error && <Failure message={(preview.error as Error).message} />}

      {result && (
        <div className="mt-5">
          <Kv label="Aktif" value={result.aktif ? "ya" : "tidak"} />
          <div className="flex flex-wrap gap-2 mt-4">
            {result.jadwal.map((item) => (
              <span
                key={item.urutan}
                className="px-3 py-1.5 rounded-lg bg-black/40 border border-emerald-500/20 text-xs font-mono text-emerald-400"
              >
                #{item.urutan + 1} · {seconds(item.detik)}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function PhoneCard() {
  const [number, setNumber] = useState("0812-3456-7890");
  const check = useMutation({ mutationFn: whatsappService.normalizePhone });

  const result: PhoneResult | undefined = check.data;

  return (
    <Card
      icon={<Phone className="w-5 h-5 text-emerald-400" />}
      title="Normalisasi nomor"
      description="Nomor Indonesia diseragamkan ke format internasional tanpa tanda plus, sekaligus bentuk WhatsApp ID-nya."
    >
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          className={INPUT}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="0812-3456-7890"
        />
        <button
          className={BUTTON}
          onClick={() => check.mutate(number)}
          disabled={check.isPending}
        >
          {check.isPending ? "Memeriksa…" : "Normalisasi"}
        </button>
      </div>

      {check.error && <Failure message={(check.error as Error).message} />}

      {result && (
        <div className="mt-4">
          <Kv label="Normalisasi" value={result.normalisasi || "(kosong)"} />
          <Kv label="WID" value={result.wid || "(kosong)"} />
          <Kv label="Bisa dipakai" value={result.terpakai ? "ya" : "tidak"} />
        </div>
      )}
    </Card>
  );
}

function MediaCard() {
  const [payload, setPayload] = useState("aGFsbyBkdW5pYQ==");
  const [filename, setFilename] = useState("bukti.png");
  const inspect = useMutation({ mutationFn: whatsappService.inspectMedia });

  const result: MediaResult | undefined = inspect.data;

  return (
    <Card
      icon={<Paperclip className="w-5 h-5 text-emerald-400" />}
      title="Penerjemahan berkas"
      description="Satu isi berkas, tiga bentuk yang diminta gateway berbeda: data URI, base64 telanjang, dan byte mentah. Jenisnya menentukan berkas dikirim sebagai gambar atau dokumen."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-zinc-400 sm:col-span-2">
          Isi berkas (base64 atau data URI)
          <input
            className={INPUT}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
        </label>
        <label className="text-sm text-zinc-400">
          Nama berkas
          <input
            className={INPUT}
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          />
        </label>
      </div>

      <button
        className={`${BUTTON} mt-4`}
        onClick={() => inspect.mutate({ payload, filename })}
        disabled={inspect.isPending}
      >
        {inspect.isPending ? "Memeriksa…" : "Periksa berkas"}
      </button>

      {inspect.error && <Failure message={(inspect.error as Error).message} />}

      {result && (
        <div className="mt-4">
          <Kv label="Jenis" value={result.jenis} />
          <Kv label="Nama berkas" value={result.namaBerkas} />
          <Kv label="Dikirim sebagai" value={result.gambar ? "gambar" : "dokumen"} />
          <Kv label="Ukuran" value={result.ukuranTerbaca || "tidak diketahui"} />
          <Kv
            label="Melebihi batas WhatsApp"
            value={result.melebihiBatas ? "ya" : "tidak"}
          />
          <Kv label="Data URI" value={result.dataUri} />
        </div>
      )}
    </Card>
  );
}

function PresenceCard() {
  const [state, setState] = useState("composing");
  const [duration, setDuration] = useState("5");
  const check = useMutation({ mutationFn: whatsappService.describePresence });

  const result: PresenceResult | undefined = check.data;

  return (
    <Card
      icon={<Activity className="w-5 h-5 text-emerald-400" />}
      title="Keadaan indikator"
      description="Istilah tiap gateway dipetakan ke satu kosakata. Durasi wajib ada saat menampilkan indikator — tanpa itu Fonnte dan Evolution API gagal secara senyap."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-zinc-400">
          Keadaan
          <input className={INPUT} value={state} onChange={(e) => setState(e.target.value)} />
        </label>
        <label className="text-sm text-zinc-400">
          Durasi (detik)
          <input
            className={INPUT}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
      </div>

      <button
        className={`${BUTTON} mt-4`}
        onClick={() =>
          check.mutate({
            state,
            duration: duration.trim() === "" ? null : duration.trim(),
          })
        }
        disabled={check.isPending}
      >
        {check.isPending ? "Memeriksa…" : "Terjemahkan"}
      </button>

      {check.error && <Failure message={(check.error as Error).message} />}

      {result && (
        <div className="mt-4">
          <Kv label="Kosakata baku" value={result.keadaan} />
          <Kv label="Label" value={result.label} />
          <Kv label="Durasi" value={`${result.durasi} detik (${result.milidetik} ms)`} />
          <Kv
            label="Menampilkan indikator"
            value={result.menampilkanIndikator ? "ya" : "tidak"}
          />
        </div>
      )}
    </Card>
  );
}

/**
 * Payload yang benar-benar akan dipos Fonnte.
 *
 * Bedanya dengan tiga kartu di atas: di sini semuanya bertemu sekaligus —
 * jeda hasil pacing, lama indikator ketik, dan seluruh batch yang dikemas ke
 * satu field. Kartu ini memanggil jalur kirim yang sama, hanya request-nya
 * yang diganti klien yang selalu gagal.
 */
function PlanCard() {
  const [messages, setMessages] = useState(
    "081234567890 | Halo, ini contoh pesan pertama.\n081298765432 | Pesan kedua, ke nomor yang berbeda.",
  );
  const [cycle, setCycle] = useState("");
  const [typing, setTyping] = useState(false);
  const preview = useMutation({ mutationFn: whatsappService.previewPlan });

  const result: PlanResult | undefined = preview.data;

  const run = () =>
    preview.mutate({
      messages: parseMessages(messages),
      // Dikirim hanya bila diisi. Mengirim `{ cycle: "" }` bukan berarti "ikut
      // .env" — itu penimpaan yang mengosongkan siklus, dan hasilnya berbeda.
      ...(cycle.trim() === "" ? {} : { pacing: { cycle: cycle.trim() } }),
      ...(typing ? { typing: { enabled: true } } : {}),
    });

  return (
    <Card
      icon={<Send className="w-5 h-5 text-emerald-400" />}
      title="Pratinjau payload Fonnte"
      description="Rencana kirim Fonnte, apa adanya: jeda tiap pesan, lama indikator ketik yang dihitung, dan JSON akhir yang menjadi isi field data. Satu baris satu pesan: “nomor | pesan”, boleh ditambah “| jeda” di belakangnya untuk memaksa jeda tertentu. Yang tidak disebutkan tetap mengikuti .env."
    >
      <label className="text-sm text-zinc-400">
        Daftar pesan (satu per baris)
        <textarea
          className={`${INPUT} mt-1 font-mono text-sm min-h-28`}
          value={messages}
          onChange={(e) => setMessages(e.target.value)}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        <label className="text-sm text-zinc-400">
          Siklus pacing (kosong = ikut .env)
          <input
            className={INPUT}
            value={cycle}
            onChange={(e) => setCycle(e.target.value)}
            placeholder="0,30"
          />
        </label>
        <label className="flex items-center gap-3 text-sm text-zinc-400 sm:self-end sm:pb-3">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-500"
            checked={typing}
            onChange={(e) => setTyping(e.target.checked)}
          />
          Paksa indikator mengetik
        </label>
      </div>

      <button className={`${BUTTON} mt-4`} onClick={run} disabled={preview.isPending}>
        {preview.isPending ? "Menyusun…" : "Susun payload"}
      </button>

      {preview.error && <Failure message={(preview.error as Error).message} />}

      {result && (
        <div className="mt-5">
          <Kv label="Gateway" value={result.gateway} />
          <Kv label="Jumlah pesan" value={result.jumlahPesan} />
          <Kv label="Field pembawa" value={result.field} />

          {result.tujuanBerulang.length > 0 && (
            <p className="mt-4 flex items-start gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Tujuan berulang: {result.tujuanBerulang.join(", ")}. Mengirim ke
                satu nomor berkali-kali dalam satu panggilan adalah pola yang
                paling cepat memicu pemblokiran.
              </span>
            </p>
          )}

          <table className="w-full mt-4 text-sm">
            <thead>
              <tr className="text-zinc-500 text-xs uppercase tracking-wide">
                <th className="text-left py-2">#</th>
                <th className="text-left py-2">Tujuan</th>
                <th className="text-left py-2">Pesan</th>
                <th className="text-right py-2">Jeda</th>
                <th className="text-right py-2">Indikator</th>
              </tr>
            </thead>
            <tbody>
              {result.pesan.map((item, index) => (
                <tr key={index} className="border-t border-white/5">
                  <td className="py-2 text-zinc-300">{index + 1}</td>
                  <td className="py-2 text-zinc-300 font-mono">{item.destination}</td>
                  <td className="py-2 text-zinc-400 max-w-xs truncate" title={item.message}>
                    {item.message}
                  </td>
                  <td className="py-2 text-right text-emerald-400 font-mono">
                    {seconds(item.delay)}
                  </td>
                  {/* `null` di sini berarti fitur indikatornya mati, bukan
                      "tanpa aturan" seperti pada jeda — jadi ditulis berbeda. */}
                  <td className="py-2 text-right text-emerald-400 font-mono">
                    {item.typing === null ? "mati" : `${item.typing} detik`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
            Kolom jeda masuk ke payload di bawah. Kolom indikator tidak: ia
            dikirim sebagai request terpisah, dan Fonnte hanya memunculkannya
            untuk tujuan <span className="text-zinc-400">pertama</span> —
            memunculkannya untuk semua tujuan membuat penerima terakhir melihat
            “sedang mengetik” lalu diam lama sebelum pesannya datang.
          </p>

          <p className="text-xs uppercase tracking-wide text-zinc-500 mt-6 mb-2">
            Isi field {result.field}
          </p>
          <pre className="bg-black/40 border border-white/10 rounded-lg p-4 text-xs font-mono text-emerald-300 overflow-x-auto">
            {result.payload}
          </pre>
          <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
            Badannya <span className="font-mono text-zinc-400">form-urlencoded</span>:
            JSON di atas dikirim sebagai nilai field{" "}
            <span className="font-mono text-zinc-400">{result.field}</span>, bukan
            sebagai badan JSON. Tujuannya diteruskan apa adanya — Fonnte sendiri
            yang menormalkan nomornya.
          </p>
        </div>
      )}
    </Card>
  );
}

function WhatsappPlayground() {
  return (
    <div className="min-h-screen selection:bg-emerald-500/30">
      <main className="max-w-5xl mx-auto pt-28 pb-20 px-6">
        <header className="mb-12">
          <p className="text-emerald-400 font-mono text-sm mb-3">sikuwa-js</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5 text-white">
            Playground <span className="text-emerald-400">SIKUWA</span>
          </h1>
          <p className="text-zinc-400 text-lg max-w-3xl leading-relaxed">
            Pustaka SIKUWA hasil porting dari PHP ke TypeScript, dijalankan di
            dalam runtime template ini. Semua yang dihitung di halaman ini
            murni — <span className="text-zinc-200">tidak ada pesan WhatsApp
            yang benar-benar dikirim</span>. Ketujuh gateway sudah selesai
            diporting; kartu terakhir mempratinjau payload Fonnte, satu-satunya
            yang perakitannya ditampilkan di sini.
          </p>
        </header>

        <div className="grid gap-8">
          <ConfigCard />
          <PacingCard />
          <TypingCard />
          <ThrottleCard />
          <div className="grid gap-8 md:grid-cols-2">
            <PhoneCard />
            <PresenceCard />
          </div>
          <MediaCard />
          <PlanCard />
        </div>
      </main>
    </div>
  );
}
