const favoriteItemSchema = {
  type: 'object',
  properties: {
    provider:   { type: 'string', example: 'asilmedia' },
    contentUrl: { type: 'string', example: 'https://asilmedia.org/12345-film.html' },
    title:      { type: 'string', nullable: true },
    thumbnail:  { type: 'string', nullable: true },
  },
};

const historyItemSchema = {
  type: 'object',
  properties: {
    provider:   { type: 'string', example: 'asilmedia' },
    contentUrl: { type: 'string' },
    title:      { type: 'string', nullable: true },
    thumbnail:  { type: 'string', nullable: true },
    watchedAt:  { type: 'string', format: 'date-time' },
  },
};

const tokenPair = {
  type: 'object',
  properties: {
    accessToken:  { type: 'string', description: 'JWT, 15 daqiqa' },
    refreshToken: { type: 'string', description: 'JWT, 7 kun' },
  },
};

module.exports = {
  tags: [{ name: 'Auth', description: 'Ro\'yxatdan o\'tish, kirish, profil, sevimlilar, tarix' }],
  paths: {

    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Ro\'yxatdan o\'tish — 1-bosqich (OTP yuborish)',
        description: 'Email/username/password tekshiriladi, mavjud emasligi tasdiqlansa — emailga 6 xonali OTP yuboriladi. Foydalanuvchi `/auth/register/verify` chaqirgunga qadar yaratilmaydi.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'username', 'password'],
                properties: {
                  email:    { type: 'string', format: 'email', example: 'user@example.com' },
                  username: { type: 'string', example: 'john_doe' },
                  password: { type: 'string', format: 'password', example: 'Secret123!' },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'OTP yuborildi',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message:   { type: 'string', example: 'Tasdiqlash kodi emailingizga yuborildi' },
                    email:     { type: 'string' },
                    expiresIn: { type: 'integer', example: 600, description: 'soniyada' },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          409: { description: 'Email yoki username allaqachon band' },
          429: { description: "Yangi kod so'rashdan oldin biroz kuting" },
        },
      },
    },

    '/auth/register/resend': {
      post: {
        tags: ['Auth'],
        summary: 'OTP ni qayta yuborish',
        description: '60 sekundlik kuldown bor. Username va parol yangidan kerak emas — ular birinchi qadamda saqlangan.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: {
          202: { description: 'Yangi OTP yuborildi' },
          404: { description: "Bu email uchun kutilayotgan ro'yxat topilmadi" },
          429: { description: 'Kuldown' },
        },
      },
    },

    '/auth/register/verify': {
      post: {
        tags: ['Auth'],
        summary: "Ro'yxatdan o'tish — 2-bosqich (OTP tasdiqlash)",
        description: 'OTP to\'g\'ri bo\'lsa — User yaratiladi, accessToken/refreshToken qaytariladi.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'otp'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  otp:   { type: 'string', example: '482915', description: '6 xonali kod' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Foydalanuvchi yaratildi",
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    tokenPair,
                    { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
                  ],
                },
              },
            },
          },
          400: { description: "OTP noto'g'ri yoki muddati tugagan" },
          429: { description: "Juda ko'p urinish" },
        },
      },
    },

    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Kirish (email yoki username + parol)',
        description: '`identifier` maydoni email yoki username bo\'lishi mumkin — `@` belgisi bilan farqlanadi. Eski `email` maydoni ham qabul qilinadi.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['identifier', 'password'],
                properties: {
                  identifier: { type: 'string', example: 'user@example.com', description: 'Email yoki username' },
                  password:   { type: 'string', format: 'password', example: 'Secret123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Muvaffaqiyatli kirildi',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    tokenPair,
                    { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
                  ],
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Parolni tiklash — OTP yuborish',
        description: "Email tizimda bo'lsa, OTP yuboriladi. Email mavjudligini oshkor qilmaslik uchun har doim 202 qaytadi.",
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: {
          202: { description: 'Email mavjud bo\'lsa OTP yuborildi' },
          400: { $ref: '#/components/responses/BadRequest' },
        },
      },
    },

    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Parolni tiklash — yangi parol o\'rnatish',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'otp', 'newPassword'],
                properties: {
                  email:       { type: 'string', format: 'email' },
                  otp:         { type: 'string', example: '482915' },
                  newPassword: { type: 'string', format: 'password', example: 'NewSecret123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Parol yangilandi va yangi tokenlar berildi',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    tokenPair,
                    { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
                  ],
                },
              },
            },
          },
          400: { description: "OTP noto'g'ri yoki parol qisqa" },
          404: { description: 'Foydalanuvchi topilmadi' },
        },
      },
    },

    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Tokenlarni yangilash',
        description: 'Yangi accessToken va refreshToken qaytaradi. Eski refreshToken bekor qilinadi (rotation).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: {
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Yangi token juftligi',
            content: { 'application/json': { schema: tokenPair } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Chiqish (refresh tokenni bekor qilish)',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Muvaffaqiyatli chiqildi' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/auth/profile': {
      get: {
        tags: ['Auth'],
        summary: 'Profilni olish',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Profil ma\'lumotlari',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      put: {
        tags: ['Auth'],
        summary: 'Profilni yangilash',
        description: 'Faqat yuborilgan maydonlar yangilanadi. Hammasi ixtiyoriy.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  username:    { type: 'string', example: 'new_username' },
                  displayName: { type: 'string', example: 'John Doe' },
                  photoURL:    { type: 'string', example: 'https://cdn.example.com/avatar.jpg' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Yangilangan profil',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          409: { description: 'Username band' },
        },
      },
    },

    '/auth/favorites': {
      get: {
        tags: ['Auth'],
        summary: 'Sevimlilar ro\'yxati',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Sevimli kontentlar',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { items: { type: 'array', items: favoriteItemSchema } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Auth'],
        summary: 'Sevimlilarga qo\'shish',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['provider', 'contentUrl'],
                properties: {
                  provider:   { type: 'string', example: 'asilmedia' },
                  contentUrl: { type: 'string', example: 'https://asilmedia.org/12345-film.html' },
                  title:      { type: 'string', description: 'Ixtiyoriy' },
                  thumbnail:  { type: 'string', description: 'Ixtiyoriy' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Yangilangan foydalanuvchi' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      delete: {
        tags: ['Auth'],
        summary: 'Sevimlilardan o\'chirish',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['contentUrl'],
                properties: { contentUrl: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'O\'chirildi' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/auth/history': {
      get: {
        tags: ['Auth'],
        summary: 'Tomosha tarixi (so\'nggi 50 ta)',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Tomosha tarixi',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { items: { type: 'array', items: historyItemSchema } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Auth'],
        summary: 'Tomosha tarixiga qo\'shish',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['provider', 'contentUrl'],
                properties: {
                  provider:   { type: 'string', example: 'asilmedia' },
                  contentUrl: { type: 'string' },
                  title:      { type: 'string', description: 'Ixtiyoriy' },
                  thumbnail:  { type: 'string', description: 'Ixtiyoriy' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Qo\'shildi' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      delete: {
        tags: ['Auth'],
        summary: 'Butun tomosha tarixini tozalash',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Tarix tozalandi' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/auth/history/item': {
      delete: {
        tags: ['Auth'],
        summary: 'Tarixdan bitta yozuvni o\'chirish',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['contentUrl'],
                properties: { contentUrl: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'O\'chirildi' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
  },
};
