const authSwagger = require('../swagger/auth.swagger');
const contentSwagger = require('../swagger/content.swagger');

const modules = [authSwagger, contentSwagger];

module.exports = {
  openapi: '3.0.0',
  info: {
    title: 'Soplay API',
    version: '2.0.0',
    description: 'Multi-provider video streaming backend. Hozir: asilmedia. Keyincha: uzmovi, idub va boshqalar.',
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
          user:  { $ref: '#/components/schemas/User' },
        },
      },

      FavoriteItem: {
        type: 'object',
        properties: {
          provider:   { type: 'string', example: 'asilmedia', description: 'Kontent manbai' },
          contentUrl: { type: 'string', example: 'https://asilmedia.org/12345-film.html' },
          title:      { type: 'string', nullable: true },
          thumbnail:  { type: 'string', nullable: true },
        },
      },

      HistoryItem: {
        type: 'object',
        properties: {
          provider:   { type: 'string', example: 'asilmedia', description: 'Kontent manbai' },
          contentUrl: { type: 'string' },
          title:      { type: 'string', nullable: true },
          thumbnail:  { type: 'string', nullable: true },
          watchedAt:  { type: 'string', format: 'date-time' },
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
          favorites:    { type: 'array', items: { $ref: '#/components/schemas/FavoriteItem' } },
          watchHistory: { type: 'array', items: { $ref: '#/components/schemas/HistoryItem' } },
          createdAt:    { type: 'string', format: 'date-time' },
        },
      },

      HomeSection: {
        type: 'object',
        description: 'Har provider o\'z key/label/items ni belgilaydi — Flutter hardcode qilmaydi',
        properties: {
          key:   { type: 'string', example: 'latest', description: 'Unikal kalit' },
          label: { type: 'string', example: 'Yangilar', description: 'UI da ko\'rsatiladigan sarlavha' },
          items: { type: 'array', items: { $ref: '#/components/schemas/ContentCard' } },
        },
      },

      BannerCard: {
        type: 'object',
        description: 'Hero slider item — ContentCard + genres field',
        properties: {
          provider:   { type: 'string', example: 'asilmedia' },
          externalId: { type: 'string', example: '18201' },
          title:      { type: 'string' },
          slug:       { type: 'string' },
          contentUrl: { type: 'string', example: 'https://asilmedia.org/18201-film.html' },
          thumbnail:  { type: 'string', nullable: true },
          year:       { type: 'integer', nullable: true },
          rating:     { type: 'integer' },
          qualities:  { type: 'array', items: { type: 'string' } },
          category:   { type: 'string', nullable: true },
          genres:     { type: 'array', items: { type: 'string' }, example: ['drama', 'detektiv'] },
        },
      },

      ContentCard: {
        type: 'object',
        description: 'Barcha providerlar uchun bir xil shape',
        properties: {
          provider:   { type: 'string', example: 'asilmedia', description: 'Kontent manbai' },
          externalId: { type: 'string', example: '18212' },
          title:      { type: 'string' },
          slug:       { type: 'string' },
          contentUrl: { type: 'string', example: 'https://asilmedia.org/18212-film.html' },
          thumbnail:  { type: 'string', nullable: true },
          year:       { type: 'integer', nullable: true },
          rating:     { type: 'integer', description: 'User vote score (+7, 0, -2...)' },
          qualities:  { type: 'array', items: { type: 'string' }, example: ['1080p', '720p', '480p'] },
          category:   { type: 'string', nullable: true },
        },
      },

      ContentList: {
        type: 'object',
        properties: {
          provider:   { type: 'string', example: 'asilmedia' },
          items:      { type: 'array', items: { $ref: '#/components/schemas/ContentCard' } },
          page:       { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },

      Episode: {
        type: 'object',
        properties: {
          episode:  { type: 'integer', example: 1 },
          label:    { type: 'string', example: '1-qism' },
          videoUrl: { type: 'string', description: 'To\'g\'ridan-to\'g\'ri MP4/video URL' },
        },
      },

      VideoSource: {
        type: 'object',
        properties: {
          quality:    { type: 'string', example: '720p' },
          videoUrl:   { type: 'string', description: 'To\'g\'ridan-to\'g\'ri MP4/video URL' },
          isDefault:  { type: 'boolean' },
          accessible: { type: 'boolean', description: 'HEAD tekshiruvi — false bo\'lsa URL 404 qaytargan' },
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
        description: 'Barcha providerlar uchun bir xil shape',
        properties: {
          provider:     { type: 'string', example: 'asilmedia' },
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
          playerSrc:    { type: 'string', nullable: true, description: 'To\'g\'ridan-to\'g\'ri video URL — birinchi epizod yoki default sifat' },
          contentUrl:   { type: 'string', description: 'Kontent URL (provider sahifasidagi)' },
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
        description: 'Provider serveridan javob olishda xato',
        content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } },
      },
    },
  },
};
