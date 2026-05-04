const authSwagger = require('../swagger/auth.swagger');
const contentSwagger = require('../swagger/content.swagger');
const commentSwagger = require('../swagger/comment.swagger');

const modules = [authSwagger, contentSwagger, commentSwagger];

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
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Local auth: `POST /auth/login` yoki `/auth/register` dan olingan `accessToken`. Firebase: Firebase Auth SDK `user.getIdToken()`. Ikkalasi ham qabul qilinadi.',
      },
    },
    schemas: {

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
          displayName:  { type: 'string', nullable: true },
          authProvider: { type: 'string', enum: ['local', 'google', 'firebase'], example: 'local' },
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

      CastMember: {
        type: 'object',
        properties: {
          id:    { type: 'string', example: 'miray_dogan', description: 'Unikal identifikator (provider bo\'yicha barqaror)' },
          name:  { type: 'string', example: 'Miray Dogan' },
          image: { type: 'string', description: 'Aktyor rasmi. Bo\'lmasa ui-avatars.com default avatar' },
        },
      },

      Episode: {
        type: 'object',
        properties: {
          episode:  { type: 'integer', example: 1 },
          label:    { type: 'string', example: '1-qism' },
          mediaRef: { type: 'string', description: '/contents/media?ref=<mediaRef>&provider=<provider> ga yuboriladi' },
        },
      },

      VideoSource: {
        type: 'object',
        properties: {
          quality:   { type: 'string', example: '720p' },
          videoUrl:  { type: 'string', description: 'To\'g\'ridan-to\'g\'ri MP4/video URL' },
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
        description: 'Yengil metadata payload — ijro uchun /contents/episodes ga alohida murojaat qiling',
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
          cast:         { type: 'array', items: { $ref: '#/components/schemas/CastMember' } },
          country:      { type: 'string', nullable: true },
          director:     { type: 'string', nullable: true },
          duration:     { type: 'string', nullable: true },
          isSerial:     { type: 'boolean', description: 'true bo\'lsa /contents/episodes episodes qaytaradi, aks holda videoSources' },
          screenshots:  { type: 'array', items: { $ref: '#/components/schemas/Screenshot' } },
          related:      { type: 'array', items: { $ref: '#/components/schemas/ContentCard' } },
          contentUrl:   { type: 'string', description: 'Kontent URL (provider sahifasidagi)' },
        },
      },

      CommentAuthor: {
        type: 'object',
        properties: {
          id:          { type: 'string', example: '655e7a2b9c1f0a0012345678' },
          username:    { type: 'string', example: 'john_doe' },
          displayName: { type: 'string', nullable: true, example: 'John Doe' },
          photoURL:    { type: 'string', nullable: true },
        },
      },

      Comment: {
        type: 'object',
        properties: {
          id:         { type: 'string', example: '660a1b2c3d4e5f0012345678' },
          provider:   { type: 'string', example: 'asilmedia' },
          contentUrl: { type: 'string', example: 'https://asilmedia.org/17987-arosat-oramizda.html' },
          text:       { type: 'string', example: 'Juda yaxshi serial!' },
          parentId:   { type: 'string', nullable: true, description: 'Top-level izoh uchun null, javoblar uchun parent ID' },
          user:       { $ref: '#/components/schemas/CommentAuthor' },
          likeCount:  { type: 'integer', example: 12 },
          likedByMe:  { type: 'boolean', description: 'Faqat Authorization header berilganda to\'g\'ri to\'ldiriladi' },
          edited:     { type: 'boolean' },
          replyCount: { type: 'integer', description: 'Top-level izohlar uchun javoblar soni' },
          createdAt:  { type: 'string', format: 'date-time' },
          updatedAt:  { type: 'string', format: 'date-time' },
        },
      },

      CommentList: {
        type: 'object',
        properties: {
          items:      { type: 'array', items: { $ref: '#/components/schemas/Comment' } },
          page:       { type: 'integer' },
          totalPages: { type: 'integer' },
          total:      { type: 'integer' },
        },
      },

      EpisodesPayload: {
        type: 'object',
        description: 'Ijro payloadi — serial bo\'lsa episodes, kino bo\'lsa videoSources+playerSrc',
        properties: {
          provider:     { type: 'string', example: 'asilmedia' },
          contentUrl:   { type: 'string' },
          isSerial:     { type: 'boolean' },
          episodes:     { type: 'array', items: { $ref: '#/components/schemas/Episode' }, description: 'Faqat isSerial=true bo\'lganda. Har epizod mediaRef qaytaradi — video URL ni /contents/media orqali oling' },
          videoSources: { type: 'array', items: { $ref: '#/components/schemas/VideoSource' }, description: 'Faqat isSerial=false bo\'lganda — video URL allaqachon hal qilingan' },
          playerSrc:    { type: 'string', nullable: true, description: 'Faqat isSerial=false bo\'lganda — default video URL' },
          headers:      { type: 'object', additionalProperties: { type: 'string' }, description: 'Faqat isSerial=false bo\'lganda — playerga uzatish kerak bo\'lgan HTTP headerlar (Referer, User-Agent...)' },
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
