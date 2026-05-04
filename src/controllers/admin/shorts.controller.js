const { randomUUID } = require('crypto');
const Short      = require('../../models/Short');
const r2Service  = require('../../services/r2.service');
const { detectProvider, getProvider, normalizeDetail } = require('../../providers');

const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const MIME_TO_EXT = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

function err(message, status) {
  return Object.assign(new Error(message), { status });
}

async function resolveContent(req, res) {
  const { url } = req.query;
  if (!url?.trim()) throw err('url majburiy', 400);

  const providerName = detectProvider(url.trim());
  const raw          = await getProvider(providerName).getDetail(url.trim());
  const detail       = normalizeDetail(raw, providerName);

  res.json({
    provider:         providerName,
    contentUrl:       url.trim(),
    contentTitle:     detail.title     || null,
    contentThumbnail: detail.thumbnail || null,
  });
}

async function getUploadUrl(req, res) {
  const { type, contentType } = req.body;

  if (!type || !contentType) throw err('type va contentType majburiy', 400);

  if (type === 'video') {
    if (!ALLOWED_VIDEO_TYPES.has(contentType)) {
      throw err('Video format qabul qilinmaydi. Ruxsat etilganlar: mp4, webm, mov', 400);
    }
    const key    = `shorts/videos/${randomUUID()}.${MIME_TO_EXT[contentType]}`;
    const result = await r2Service.getPresignedUploadUrl(key, contentType);
    return res.json(result);
  }

  if (type === 'thumbnail') {
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw err('Rasm format qabul qilinmaydi. Ruxsat etilganlar: jpg, png, webp', 400);
    }
    const key    = `shorts/thumbnails/${randomUUID()}.${MIME_TO_EXT[contentType]}`;
    const result = await r2Service.getPresignedUploadUrl(key, contentType);
    return res.json(result);
  }

  throw err("type faqat 'video' yoki 'thumbnail' bo'lishi mumkin", 400);
}

async function create(req, res) {
  const {
    title, description, provider, contentUrl,
    contentTitle, contentThumbnail,
    videoKey, thumbnailKey, tags,
  } = req.body;

  if (!title?.trim())    throw err('title majburiy', 400);
  if (!provider?.trim()) throw err('provider majburiy', 400);
  if (!videoKey)         throw err('videoKey majburiy (avval /upload-url orqali yuklang)', 400);

  const PUBLIC_URL   = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const videoUrl     = `${PUBLIC_URL}/${videoKey}`;
  const thumbnailUrl = thumbnailKey ? `${PUBLIC_URL}/${thumbnailKey}` : null;

  const short = await Short.create({
    title:            title.trim(),
    description:      description?.trim()      || null,
    provider:         provider.trim(),
    contentUrl:       contentUrl?.trim()       || null,
    contentTitle:     contentTitle?.trim()     || null,
    contentThumbnail: contentThumbnail?.trim() || null,
    videoKey,
    videoUrl,
    thumbnailKey:     thumbnailKey || null,
    thumbnailUrl,
    tags:             Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : [],
    createdBy:        req.admin._id,
  });

  res.status(201).json({ item: short });
}

async function list(req, res) {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const skip  = (page - 1) * limit;

  const filter = {};
  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.tag)      filter.tags     = req.query.tag;

  const [items, total] = await Promise.all([
    Short.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Short.countDocuments(filter),
  ]);

  const formatted = items.map(s => ({ ...s, likeCount: s.likes.length, likes: undefined }));
  res.json({ items: formatted, page, totalPages: Math.ceil(total / limit), total });
}

async function getOne(req, res) {
  const short = await Short.findById(req.params.id).lean();
  if (!short) throw err('Short topilmadi', 404);
  res.json({ item: { ...short, likeCount: short.likes.length, likes: undefined } });
}

async function update(req, res) {
  const short = await Short.findById(req.params.id);
  if (!short) throw err('Short topilmadi', 404);

  const { title, description, provider, contentUrl, contentTitle, contentThumbnail, tags } = req.body;

  if (title            !== undefined) short.title            = title.trim();
  if (description      !== undefined) short.description      = description?.trim()      || null;
  if (provider         !== undefined) short.provider         = provider.trim();
  if (contentUrl       !== undefined) short.contentUrl       = contentUrl?.trim()       || null;
  if (contentTitle     !== undefined) short.contentTitle     = contentTitle?.trim()     || null;
  if (contentThumbnail !== undefined) short.contentThumbnail = contentThumbnail?.trim() || null;
  if (tags             !== undefined) short.tags             = Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : [];

  await short.save();
  const obj = short.toObject();
  res.json({ item: { ...obj, likeCount: obj.likes.length, likes: undefined } });
}

async function remove(req, res) {
  const short = await Short.findById(req.params.id);
  if (!short) throw err('Short topilmadi', 404);

  const deletes = [r2Service.deleteFile(short.videoKey)];
  if (short.thumbnailKey) deletes.push(r2Service.deleteFile(short.thumbnailKey));
  await Promise.allSettled(deletes);

  await short.deleteOne();
  res.json({ success: true });
}

module.exports = { resolveContent, getUploadUrl, create, list, getOne, update, remove };
