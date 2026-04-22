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
                  email: { type: 'string', format: 'email', example: 'john@example.com' },
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
        summary: 'Kirish',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'john@example.com' },
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
    },
  },
};
