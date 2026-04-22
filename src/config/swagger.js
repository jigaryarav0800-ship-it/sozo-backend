const authSwagger = require('../swagger/auth.swagger');
const contentSwagger = require('../swagger/content.swagger');

const modules = [authSwagger, contentSwagger];

module.exports = {
  openapi: '3.0.0',
  info: {
    title: 'Soplay API',
    version: '1.0.0',
    description: 'Asilmedia.org real-time proxy & user auth backend',
  },
  servers: [{ url: '/api' }],
  tags: modules.flatMap((m) => m.tags),
  paths: Object.assign({}, ...modules.map((m) => m.paths)),
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      AuthResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
      User: {
        type: 'object',
        properties: {
          _id:          { type: 'string' },
          username:     { type: 'string' },
          email:        { type: 'string' },
          photoURL:     { type: 'string', nullable: true },
          authProvider: { type: 'string', enum: ['local', 'google'], example: 'local' },
          favorites:    { type: 'array', items: { type: 'string' }, description: 'Content URLs' },
          watchHistory: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                contentUrl: { type: 'string' },
                title:      { type: 'string', nullable: true },
                thumbnail:  { type: 'string', nullable: true },
                watchedAt:  { type: 'string', format: 'date-time' },
              },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ContentCard: {
        type: 'object',
        properties: {
          externalId: { type: 'string', example: '18212' },
          title: { type: 'string' },
          slug: { type: 'string' },
          url: { type: 'string', example: 'https://asilmedia.org/18212-film.html' },
          thumbnail: { type: 'string', nullable: true },
          year: { type: 'integer', nullable: true },
          rating: { type: 'integer', description: 'User vote score (+7, 0, -2...)' },
          qualities: { type: 'array', items: { type: 'string' }, example: ['1080p', '720p', '480p'] },
          category: { type: 'string', nullable: true },
        },
      },
      ContentList: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/ContentCard' } },
          page: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      Episode: {
        type: 'object',
        properties: {
          episode:   { type: 'integer', example: 1 },
          label:     { type: 'string', example: '1-qism' },
          videoUrl:  { type: 'string' },
          playerUrl: { type: 'string', description: 'asilmedia.org player URL' },
        },
      },
      VideoSource: {
        type: 'object',
        properties: {
          quality:   { type: 'string', example: '720p' },
          videoUrl:  { type: 'string' },
          playerUrl: { type: 'string' },
          isDefault: { type: 'boolean' },
        },
      },
      Screenshot: {
        type: 'object',
        properties: {
          full:  { type: 'string', nullable: true },
          thumb: { type: 'string', nullable: true },
        },
      },
      ContentDetail: {
        type: 'object',
        properties: {
          contentId:    { type: 'string', nullable: true },
          title:        { type: 'string' },
          description:  { type: 'string', nullable: true },
          thumbnail:    { type: 'string', nullable: true },
          year:         { type: 'integer', nullable: true },
          likes:        { type: 'integer', example: 92 },
          dislikes:     { type: 'integer', example: 7 },
          genres:       { type: 'array', items: { type: 'string' } },
          cast:         { type: 'array', items: { type: 'string' } },
          country:      { type: 'string', nullable: true },
          director:     { type: 'string', nullable: true },
          duration:     { type: 'string', nullable: true },
          isSerial:     { type: 'boolean' },
          episodes:     { type: 'array', items: { $ref: '#/components/schemas/Episode' }, description: 'Faqat seriallar uchun' },
          videoSources: { type: 'array', items: { $ref: '#/components/schemas/VideoSource' }, description: 'Faqat kinolar uchun' },
          screenshots:  { type: 'array', items: { $ref: '#/components/schemas/Screenshot' } },
          related:      { type: 'array', items: { $ref: '#/components/schemas/ContentCard' } },
          playerSrc:    { type: 'string', nullable: true, description: 'Tayyor player URL (birinchi epizod yoki default sifat)' },
          url:          { type: 'string' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Noto\'g\'ri so\'rov',
        content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } },
      },
      Unauthorized: {
        description: 'Token kerak',
        content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } },
      },
      NotFound: {
        description: 'Topilmadi',
        content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } },
      },
      BadGateway: {
        description: 'asilmedia.org dan javob olishda xato',
        content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } },
      },
    },
  },
};
