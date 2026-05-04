const pageParam = {
  in: 'query', name: 'page',
  schema: { type: 'integer', default: 1, minimum: 1 },
  description: 'Sahifa raqami',
};

const limitParam = {
  in: 'query', name: 'limit',
  schema: { type: 'integer', default: 20, minimum: 1, maximum: 50 },
  description: 'Bir sahifadagi elementlar (max 50)',
};

module.exports = {
  tags: [{ name: 'Shorts', description: 'Qisqa metrajli sahnalar — ommaviy kirish. Like uchun autentifikatsiya talab etiladi.' }],
  paths: {

    '/shorts': {
      get: {
        tags: ['Shorts'],
        summary: 'Shorts ro\'yxati',
        description: 'Barcha shortslar, eng yangilaridan boshlab. `Authorization` header berilsa, `likedByMe` to\'ldiriladi.',
        parameters: [
          pageParam,
          limitParam,
          {
            in: 'query', name: 'provider',
            schema: { type: 'string', example: 'asilmedia' },
            description: 'Provider bo\'yicha filtr',
          },
          {
            in: 'query', name: 'tag',
            schema: { type: 'string', example: 'drama' },
            description: 'Tag bo\'yicha filtr',
          },
        ],
        responses: {
          200: {
            description: 'Shortslar ro\'yxati',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ShortList' },
              },
            },
          },
        },
      },
    },

    '/shorts/{id}': {
      get: {
        tags: ['Shorts'],
        summary: 'Bitta shortni olish',
        description: '`Authorization` header berilsa, `likedByMe` to\'ldiriladi.',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Short MongoDB ID' },
        ],
        responses: {
          200: {
            description: 'Short ma\'lumotlari',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { item: { $ref: '#/components/schemas/ShortPublic' } },
                },
              },
            },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/shorts/{id}/view': {
      post: {
        tags: ['Shorts'],
        summary: 'Ko\'rishlar sonini oshirish',
        description: 'Short ochilganda yoki videoplay boshlanganida chaqiring. Autentifikatsiya shart emas. **Rate limit:** 20/daqiqa (IP).',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Yangi views soni',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { views: { type: 'integer', example: 1024 } },
                },
              },
            },
          },
          404: { $ref: '#/components/responses/NotFound' },
          429: { description: "Juda ko'p so'rov" },
        },
      },
    },

    '/shorts/{id}/like': {
      post: {
        tags: ['Shorts'],
        summary: 'Like toggle qilish',
        description: 'Like qo\'yilgan bo\'lsa — olib tashlanadi. Qo\'yilmagan bo\'lsa — qo\'shiladi. **Autentifikatsiya talab etiladi.**',
        security: [{ BearerAuth: [] }],
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Toggle natijasi',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    liked:     { type: 'boolean', description: 'Endi like bormi', example: true },
                    likeCount: { type: 'integer', description: 'Yangi like soni', example: 48 },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

  },
};
