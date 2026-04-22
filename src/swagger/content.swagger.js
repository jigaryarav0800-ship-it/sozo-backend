const categoryEnum = [
  'tarjima-kinolar', 'xorij-kinolar', 'rus-kinolar',
  'seriallar', 'multfilmlar', 'treylerlar',
];

const pageParam = {
  in: 'query', name: 'page',
  schema: { type: 'integer', default: 1, minimum: 1 },
  description: 'Sahifa raqami',
};

module.exports = {
  tags: [{ name: 'Contents', description: 'Asilmedia.org real-time scraping' }],
  paths: {
    '/contents/categories': {
      get: {
        tags: ['Contents'],
        summary: 'Barcha kategoriyalar ro\'yxati',
        responses: {
          200: {
            description: 'Kategoriyalar',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          slug: { type: 'string' },
                          path: { type: 'string' },
                          url: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/contents/genres': {
      get: {
        tags: ['Contents'],
        summary: 'Barcha janrlar ro\'yxati',
        responses: {
          200: {
            description: 'Janrlar',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          slug: { type: 'string' },
                          url: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/contents/latest': {
      get: {
        tags: ['Contents'],
        summary: 'Asosiy sahifa — eng yangi kontentlar',
        parameters: [pageParam],
        responses: {
          200: {
            description: 'Kontentlar',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ContentList' } } },
          },
          502: { $ref: '#/components/responses/BadGateway' },
        },
      },
    },
    '/contents/search': {
      get: {
        tags: ['Contents'],
        summary: 'Kontent qidirish',
        parameters: [
          { in: 'query', name: 'q', required: true, schema: { type: 'string', minLength: 2 }, description: 'Qidiruv so\'zi' },
          pageParam,
        ],
        responses: {
          200: {
            description: 'Qidiruv natijalari',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ContentList' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          502: { $ref: '#/components/responses/BadGateway' },
        },
      },
    },
    '/contents/detail': {
      get: {
        tags: ['Contents'],
        summary: 'Kontent detail — to\'liq ma\'lumot + video player URL',
        parameters: [
          {
            in: 'query', name: 'url', required: true,
            schema: { type: 'string' },
            description: 'asilmedia.org kontent URL',
            example: 'https://asilmedia.org/18212-aybdorlik.html',
          },
        ],
        responses: {
          200: {
            description: 'Kontent ma\'lumotlari',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ContentDetail' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          502: { $ref: '#/components/responses/BadGateway' },
        },
      },
    },
    '/contents/category/{category}': {
      get: {
        tags: ['Contents'],
        summary: 'Kategoriya bo\'yicha kontentlar',
        parameters: [
          {
            in: 'path', name: 'category', required: true,
            schema: { type: 'string', enum: categoryEnum },
            description: 'Kategoriya slug',
          },
          pageParam,
        ],
        responses: {
          200: {
            description: 'Kontentlar',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ContentList' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          502: { $ref: '#/components/responses/BadGateway' },
        },
      },
    },
    '/contents/genre/{genre}': {
      get: {
        tags: ['Contents'],
        summary: 'Janr bo\'yicha kontentlar',
        parameters: [
          {
            in: 'path', name: 'genre', required: true,
            schema: { type: 'string' },
            example: 'drama',
            description: 'boevik, komediya, drama, melodrama, triller, ...',
          },
          pageParam,
        ],
        responses: {
          200: {
            description: 'Kontentlar',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ContentList' } } },
          },
          502: { $ref: '#/components/responses/BadGateway' },
        },
      },
    },
    '/contents/year/{year}': {
      get: {
        tags: ['Contents'],
        summary: 'Yil bo\'yicha kontentlar',
        parameters: [
          {
            in: 'path', name: 'year', required: true,
            schema: { type: 'integer' },
            example: 2023,
          },
          pageParam,
        ],
        responses: {
          200: {
            description: 'Kontentlar',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ContentList' } } },
          },
          502: { $ref: '#/components/responses/BadGateway' },
        },
      },
    },
  },
};
