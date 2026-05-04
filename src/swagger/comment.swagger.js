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
  tags: [{ name: 'Comments', description: 'Kontent izohlari — yozish, javob berish, like, edit, delete' }],
  paths: {

    '/comments': {
      get: {
        tags: ['Comments'],
        summary: 'Kontentning yuqori darajadagi izohlari',
        description: 'parentId=null bo\'lgan izohlar. Authorization header berilsa, har itemda `likedByMe` to\'ldiriladi.',
        parameters: [
          {
            in: 'query', name: 'provider', required: true,
            schema: { type: 'string', example: 'asilmedia' },
            description: 'Kontent manbai',
          },
          {
            in: 'query', name: 'contentUrl', required: true,
            schema: { type: 'string', example: 'https://asilmedia.org/17987-arosat-oramizda.html' },
            description: 'Kontent URL',
          },
          pageParam,
          limitParam,
        ],
        responses: {
          200: {
            description: 'Izohlar ro\'yxati',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CommentList' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
        },
      },
      post: {
        tags: ['Comments'],
        summary: 'Yangi izoh yoki javob qoldirish',
        description: '`parentId` berilsa javob bo\'ladi. Reply ga reply qoldirish mumkin emas.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['provider', 'contentUrl', 'text'],
                properties: {
                  provider:   { type: 'string', example: 'asilmedia' },
                  contentUrl: { type: 'string', example: 'https://asilmedia.org/17987-arosat-oramizda.html' },
                  text:       { type: 'string', example: 'Juda yaxshi serial!', maxLength: 2000 },
                  parentId:   { type: 'string', nullable: true, description: 'Top-level izoh ID (javob qoldirish uchun)' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Izoh yaratildi',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { item: { $ref: '#/components/schemas/Comment' } },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/comments/{id}/replies': {
      get: {
        tags: ['Comments'],
        summary: 'Top-level izohga javoblar (chronological)',
        description: 'Authorization header berilsa, har itemda `likedByMe` to\'ldiriladi.',
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' }, description: 'Top-level comment ID' },
          pageParam,
          limitParam,
        ],
        responses: {
          200: {
            description: 'Javoblar ro\'yxati',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CommentList' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/comments/{id}': {
      put: {
        tags: ['Comments'],
        summary: 'Izohni tahrirlash (faqat egasi)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text'],
                properties: { text: { type: 'string', maxLength: 2000 } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Yangilangan izoh',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { item: { $ref: '#/components/schemas/Comment' } },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Faqat izoh egasi tahrirlay oladi' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Comments'],
        summary: 'Izohni o\'chirish (faqat egasi)',
        description: 'Top-level izoh o\'chirilsa, unga tegishli barcha javoblar ham o\'chiriladi.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'O\'chirildi',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success:         { type: 'boolean', example: true },
                    cascadeDeleted:  { type: 'integer', description: 'Birga o\'chirilgan javoblar soni' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Faqat izoh egasi o\'chira oladi' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    '/comments/{id}/like': {
      post: {
        tags: ['Comments'],
        summary: 'Like ni toggle qilish',
        description: 'Agar foydalanuvchi like qo\'ygan bo\'lsa — olib tashlanadi, aks holda qo\'shiladi.',
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
                    liked:     { type: 'boolean', description: 'Endi like bormi' },
                    likeCount: { type: 'integer', description: 'Yangi like soni' },
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
