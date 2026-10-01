import ky from "ky";

export const api = {
  users: {
    getAll: "users",
    getOne: (id: number) => `users/${id}`,
    create: "users",
    update: (id: number) => `users/${id}`,
    delete: (id: number) => `users/${id}`,
  },
  // Playground SIKUWA. Seluruh endpoint di sini hanya menghitung — tidak ada
  // pesan WhatsApp yang benar-benar dikirim.
  whatsapp: {
    config: "whatsapp/config",
    providers: "whatsapp/providers",
    pacingPreview: "whatsapp/pacing/preview",
    typingPreview: "whatsapp/typing/preview",
    throttlePreview: "whatsapp/throttle/preview",
    presence: "whatsapp/presence",
    phone: "whatsapp/phone",
    media: "whatsapp/media",
    planPreview: "whatsapp/plan/preview",
  },
};

export const http = ky.create({
  prefixUrl: "/api",
  headers: {
    "Content-Type": "application/json",
  },
  hooks: {},
});
