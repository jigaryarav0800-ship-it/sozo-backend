const categoryEnum = [
  'tarjima-kinolar', 'xorij-kinolar', 'rus-kinolar',
  'seriallar', 'multfilmlar', 'treylerlar',
];

const pageParam = {
  in: 'query', name: 'page',
  schema: { type: 'integer', default: 1, minimum: 1 },
  description: 'Sahifa raqami',
};

const providerParam = {
  in: 'query', name: 'provider',
  schema: { type: 'string', default: 'asilmedia', example: 'asilmedia' },
  description: 'Kontent manbai (default: asilmedia)',
};

module.exports = {
  tags: [{ name: 'Contents', description: 'Multi-provider real-time kontent' }],
  paths: {
    '/contents/providers': {
      get: {
        tags: ['Contents'],
        summary: 'Mavjud providerlar ro\'yxati',
        responses: {
          200: {
            description: 'Providerlar',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { type: 'string' }, example: ['asilmedia'] },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/contents/categories': {
      get: {
        tags: ['Contents'],
        summary: 'Provider kategoriyalar ro\'yxati',
        parameters: [providerParam],
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
                          provider: { type: 'string', example: 'asilmedia' },
                          slug:     { type: 'string' },
                          path:     { type: 'string' },
                          url:      { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
        },
      },
    },

    '/contents/genres': {
      get: {
        tags: ['Contents'],
        summary: 'Provider janrlar ro\'yxati',
        parameters: [providerParam],
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
                          provider: { type: 'string', example: 'asilmedia' },
                          slug:     { type: 'string' },
                          url:      { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
        },
      },
    },

    '/contents/home': {
      get: {
        tags: ['Contents'],
        summary: 'Bosh sahifa — barcha bo\'limlar (parallel, keshli)',
        description: 'Bir so\'rovda latest, seriallar, tarjima kinolar va multfilmlarning dastlabki 12 tasini qaytaradi.',
        parameters: [providerParam],
        responses: {
          200: {
            description: 'Bosh sahifa ma\'lumotlari',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    provider: { type: 'string', example: 'asilmedia' },
                    banner:   { type: 'array', items: { $ref: '#/components/schemas/BannerCard' }, description: 'Hero slider — ContentCard + genres' },
                    sections: { type: 'array', items: { $ref: '#/components/schemas/HomeSection' }, description: 'Har provider o\'z tartibi va labelini belgilaydi' },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          502: { $ref: '#/components/responses/BadGateway' },
        },
      },
    },

    '/contents/latest': {
      get: {
        tags: ['Contents'],
        summary: 'Eng yangi kontentlar',
        parameters: [providerParam, pageParam],
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

    '/contents/search': {
      get: {
        tags: ['Contents'],
        summary: 'Kontent qidirish',
        parameters: [
          providerParam,
          {
            in: 'query', name: 'q', required: true,
            schema: { type: 'string', minLength: 2 },
            description: 'Qidiruv so\'zi (kamida 2 belgi)',
          },
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
        summary: 'Kontent detail — epizodlar, video sifati, skrinshot, o\'xshashlar',
        description: 'Provider `url` dan avtomatik aniqlanadi.',
        parameters: [
          {
            in: 'query', name: 'url', required: true,
            schema: { type: 'string' },
            description: 'Kontent URL (istalgan provider)',
            example: 'https://asilmedia.org/17987-arosat-oramizda.html',
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

    '/contents/check-video': {
      get: {
        tags: ['Contents'],
        summary: 'Video URL mavjudligini tekshirish (HEAD so\'rovi)',
        description: 'Provider `url` dan avtomatik aniqlanadi.',
        parameters: [
          {
            in: 'query', name: 'url', required: true,
            schema: { type: 'string' },
            description: 'MP4 yoki boshqa video URL',
            example: 'https://fayllar1.ru/37/Seriallar/Arosat/Arosat%201-1-qism.mp4',
          },
        ],
        responses: {
          200: {
            description: 'Video meta ma\'lumotlari',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    accessible:    { type: 'boolean' },
                    status:        { type: 'integer' },
                    contentType:   { type: 'string', nullable: true },
                    contentLength: { type: 'integer', nullable: true },
                    acceptRanges:  { type: 'string', nullable: true },
                    error:         { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
        },
      },
    },

    '/contents/category/{category}': {
      get: {
        tags: ['Contents'],
        summary: 'Kategoriya bo\'yicha kontentlar',
        parameters: [
          providerParam,
          {
            in: 'path', name: 'category', required: true,
            schema: { type: 'string', enum: categoryEnum },
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
          providerParam,
          {
            in: 'path', name: 'genre', required: true,
            schema: { type: 'string' },
            example: 'drama',
            description: 'boevik | komediya | drama | melodrama | triller | ...',
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

    '/contents/year/{year}': {
      get: {
        tags: ['Contents'],
        summary: 'Yil bo\'yicha kontentlar',
        parameters: [
          providerParam,
          {
            in: 'path', name: 'year', required: true,
            schema: { type: 'integer' },
            example: 2025,
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

    '/contents/country/{country}': {
      get: {
        tags: ['Contents'],
        summary: 'Mamlakat bo\'yicha kontentlar',
        parameters: [
          providerParam,
          {
            in: 'path', name: 'country', required: true,
            schema: { type: 'string' },
            example: 'турция',
            description: 'Mamlakat nomi (masalan: турция, корея, хиндистон)',
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

    '/contents/actor/{actor}': {
      get: {
        tags: ['Contents'],
        summary: 'Aktyor bo\'yicha kontentlar',
        parameters: [
          providerParam,
          {
            in: 'path', name: 'actor', required: true,
            schema: { type: 'string' },
            example: 'Miray Dogan',
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

    '/contents/director/{director}': {
      get: {
        tags: ['Contents'],
        summary: 'Rejissyor bo\'yicha kontentlar',
        parameters: [
          providerParam,
          {
            in: 'path', name: 'director', required: true,
            schema: { type: 'string' },
            example: 'Oguzhan Denizhan',
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
  },
};
