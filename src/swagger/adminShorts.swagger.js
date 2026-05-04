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
  tags: [{ name: 'Admin Shorts', description: 'Shorts boshqaruvi — faqat admin. Barcha endpointlar AdminAuth talab qiladi.' }],
  paths: {

    '/admin/shorts/upload-url': {
      post: {
        tags: ['Admin Shorts'],
        summary: 'R2 ga to\'g\'ridan-to\'g\'ri yuklash uchun presigned URL olish',
        description: [
          '**2 bosqichli yuklash jarayoni:**',
          '1. Ushbu endpoint orqali `uploadUrl` va `key` oling',
          '2. Olingan `uploadUrl` ga `PUT` so\'rovi bilan faylni yuboring (Content-Type header kerak)',
          '3. `key` ni `POST /admin/shorts` ga short yaratishda ishlating',
          '',
          '**Ruxsat etilgan formatlar:**',
          '- Video: `video/mp4`, `video/webm`, `video/quicktime`',
          '- Rasm: `image/jpeg`, `image/png`, `image/webp`',
          '',
          '**Presigned URL muddati:** 1 soat',
        ].join('\n'),
        security: [{ AdminAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type', 'contentType'],
                properties: {
                  type: {
                    type: 'string',
                    enum: ['video', 'thumbnail'],
                    description: "Fayl turi: 'video' yoki 'thumbnail'",
                  },
                  contentType: {
                    type: 'string',
                    example: 'video/mp4',
                    description: 'MIME type — yuklash uchun Content-Type header bilan mos bo\'lishi kerak',
                  },
                },
              },
              examples: {
                video: {
                  summary: 'Video uchun',
                  value: { type: 'video', contentType: 'video/mp4' },
                },
                thumbnail: {
                  summary: 'Thumbnail uchun',
                  value: { type: 'thumbnail', contentType: 'image/jpeg' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Presigned URL va fayl kaliti',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PresignedUrlResponse' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          429: { description: "Juda ko'p so'rov" },
        },
      },
    },

    '/admin/shorts': {
      get: {
        tags: ['Admin Shorts'],
        summary: 'Barcha shortslar ro\'yxati (admin)',
        description: 'Barcha shortslar, filtr va sahifalash bilan.',
        security: [{ AdminAuth: [] }],
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
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },

      post: {
        tags: ['Admin Shorts'],
        summary: 'Yangi short yaratish',
        description: [
          'Video oldin `/admin/shorts/upload-url` orqali R2 ga yuklanishi kerak.',
          'So\'ngra shu endpoint orqali `videoKey` va metadatani yuborib short yarating.',
        ].join('\n'),
        security: [{ AdminAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'provider', 'videoKey'],
                properties: {
                  title:        { type: 'string', example: 'Erkak va ayol muhabbati — eng yaxshi sahna', maxLength: 200 },
                  description:  { type: 'string', nullable: true, example: 'Serialning 12-qismidan qisqa sahna', maxLength: 1000 },
                  provider:     { type: 'string', example: 'asilmedia', description: 'Kontent manbai' },
                  contentUrl:   { type: 'string', nullable: true, example: 'https://asilmedia.org/12345-film.html', description: 'Asl kontent URL (ixtiyoriy)' },
                  videoKey:     { type: 'string', example: 'shorts/videos/uuid.mp4', description: '/upload-url dan olingan key' },
                  thumbnailKey: { type: 'string', nullable: true, example: 'shorts/thumbnails/uuid.jpg', description: '/upload-url dan olingan thumbnail key (ixtiyoriy)' },
                  tags:         { type: 'array', items: { type: 'string' }, example: ['drama', 'sevgi', 'uzbek'] },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Short yaratildi',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { item: { $ref: '#/components/schemas/Short' } },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    '/admin/shorts/{id}': {
      get: {
        tags: ['Admin Shorts'],
        summary: 'Bitta shortni olish (admin)',
        security: [{ AdminAuth: [] }],
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
                  properties: { item: { $ref: '#/components/schemas/Short' } },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },

      put: {
        tags: ['Admin Shorts'],
        summary: 'Short metadatasini tahrirlash',
        description: 'Faqat matn maydonlarini o\'zgartiradi. Video/thumbnail fayllarni almashtirish uchun avval yangi fayl yuklang, keyin `videoKey`/`thumbnailKey` ni yangilang — lekin bu almashtirish PUT da yo\'q (delete + create oqimi ishlatiladi).',
        security: [{ AdminAuth: [] }],
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title:       { type: 'string', maxLength: 200 },
                  description: { type: 'string', nullable: true, maxLength: 1000 },
                  provider:    { type: 'string' },
                  contentUrl:  { type: 'string', nullable: true },
                  tags:        { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Yangilangan short',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { item: { $ref: '#/components/schemas/Short' } },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },

      delete: {
        tags: ['Admin Shorts'],
        summary: 'Shortni o\'chirish',
        description: 'Short yozuvini MongoDB dan va video/thumbnail fayllarini Cloudflare R2 dan o\'chiradi.',
        security: [{ AdminAuth: [] }],
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
                  properties: { success: { type: 'boolean', example: true } },
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
