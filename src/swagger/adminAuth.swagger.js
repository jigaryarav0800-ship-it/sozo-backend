module.exports = {
  tags: [{ name: 'Admin Auth', description: 'Admin autentifikatsiya — faqat admin panel uchun. Hech kim ro\'yxatdan o\'ta olmaydi, faqat seed script orqali admin yaratiladi.' }],
  paths: {

    '/admin/auth/login': {
      post: {
        tags: ['Admin Auth'],
        summary: 'Admin kirish',
        description: 'Login va parol bilan admin tokenlarini olish. **Rate limit:** 5 urinish / 3 daqiqa (IP bo\'yicha).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', example: 'admin' },
                  password: { type: 'string', example: 'StrongPassword123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Muvaffaqiyatli kirish',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminLoginResponse' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: {
            description: "Login yoki parol noto'g'ri",
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } },
          },
          429: {
            description: "Juda ko'p urinish, biroz kuting",
            content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } },
          },
        },
      },
    },

    '/admin/auth/refresh': {
      post: {
        tags: ['Admin Auth'],
        summary: 'Admin access tokenni yangilash',
        description: 'Muddati tugagan access tokenni refresh token orqali yangilash.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: {
                  refreshToken: { type: 'string', description: 'Admin refresh token (30 kun amal qiladi)' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Yangi tokenlar',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    accessToken:  { type: 'string', description: '1 soat' },
                    refreshToken: { type: 'string', description: '30 kun' },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/admin/auth/logout': {
      post: {
        tags: ['Admin Auth'],
        summary: 'Admin chiqish',
        description: 'Refresh tokenni bekor qiladi. Keyingi refresh so\'rovlar muvaffaqiyatsiz bo\'ladi.',
        security: [{ AdminAuth: [] }],
        responses: {
          200: {
            description: 'Chiqildi',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { message: { type: 'string', example: 'Chiqildi' } },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

  },
};
