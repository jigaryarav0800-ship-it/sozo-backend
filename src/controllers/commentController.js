const commentService = require('../services/commentService');

async function list(req, res) {
  const { provider, contentUrl, page, limit } = req.query;
  const viewerId = req.user?._id ?? null;
  const result = await commentService.listTopLevel({ provider, contentUrl, page, limit }, viewerId);
  res.json(result);
}

async function listReplies(req, res) {
  const { page, limit } = req.query;
  const viewerId = req.user?._id ?? null;
  const result = await commentService.listReplies({ parentId: req.params.id, page, limit }, viewerId);
  res.json(result);
}

async function create(req, res) {
  const { provider, contentUrl, text, parentId } = req.body;
  const item = await commentService.create(req.user._id, { provider, contentUrl, text, parentId });
  res.status(201).json({ item });
}

async function update(req, res) {
  const { text } = req.body;
  const item = await commentService.update(req.user._id, req.params.id, { text });
  res.json({ item });
}

async function remove(req, res) {
  const result = await commentService.remove(req.user._id, req.params.id);
  res.json(result);
}

async function toggleLike(req, res) {
  const result = await commentService.toggleLike(req.user._id, req.params.id);
  res.json(result);
}

module.exports = { list, listReplies, create, update, remove, toggleLike };
