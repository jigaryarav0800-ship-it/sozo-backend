const historyItemSchema = {
  type: 'object',
  properties: {
    contentUrl: { type: 'string' },
    title:      { type: 'string', nullable: true },
    thumbnail:  { type: 'string', nullable: true },
    watchedAt:  { type: 'string', format: 'date-time' },
  },
};

module.exports = {
  tags: [{ name: 'Auth', description: 'Autentifikatsiya' }],
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Ro\'yxatdan o\'tish',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'email', 'password'],
                properties: {
                  username: { type: 'string', example: 'johndoe' },
                  email:    { type: 'string', format: 'email', example: 'john@example.com' },
                  password: { type: 'string', minLength: 6, example: 'secret123' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Muvaffaqiyatli ro\'yxatdan o\'tildi',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          409: { description: 'Email yoki username band' },
        },
      },
    },

    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Kirish (email + parol)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email:    { type: 'string', format: 'email', example: 'john@example.com' },
                  password: { type: 'string', example: 'secret123' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Muvaffaqiyatli kirildi',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/auth/google': {
      post: {
        tags: ['Auth'],
        summary: 'Google (OAuth2) orqali kirish — Firebase ID token',
        description: 'Klient Firebase Auth orqali Google\'da kiradi, so\'ng `idToken` ni yuboradi. Backend tokenni tekshirib, JWT qaytaradi.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['idToken'],
                properties: {
                  idToken: { type: 'string', description: 'Firebase Auth ID token' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Muvaffaqiyatli kirildi',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { description: 'Yaroqsiz yoki muddati o\'tgan Google token' },
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
            description: 'Profil',
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
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  username: { type: 'string' },
                  photoURL: { type: 'string' },
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
            description: 'Sevimli URL lar',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { items: { type: 'array', items: { type: 'string' } } },
                },
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
                required: ['url'],
                properties: { url: { type: 'string', example: 'https://asilmedia.org/12345-film.html' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Yangilangan foydalanuvchi' },
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
                required: ['url'],
                properties: { url: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Yangilangan foydalanuvchi' },
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
                schema: {
                  type: 'object',
                  properties: { items: { type: 'array', items: historyItemSchema } },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Auth'],
        summary: 'Tomosha tarixiga qo\'shish (dublikat bo\'lsa yangilanadi)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url'],
                properties: {
                  url:       { type: 'string', example: 'https://asilmedia.org/12345-film.html' },
                  title:     { type: 'string', example: 'Film nomi', description: 'Ixtiyoriy' },
                  thumbnail: { type: 'string', example: 'https://...', description: 'Ixtiyoriy' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Yangilangan foydalanuvchi' },
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
                required: ['url'],
                properties: { url: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'O\'chirildi' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
  },
};
