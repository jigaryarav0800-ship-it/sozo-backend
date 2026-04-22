const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://asilmedia.org';

// Actual URL paths on asilmedia.org
const CATEGORIES = {
  'tarjima-kinolar': 'films/tarjima_kinolar',
  'xorij-kinolar':   'films/xorij_kinolar',
  'rus-kinolar':     'films/rus_kinolar',
  'seriallar':       'seriallar',
  'multfilmlar':     'multfilmlar',
  'treylerlar':      'treylerlar',
};

const GENRES = [
  'boevik', 'komediya', 'drama', 'melodrama', 'triller',
  'fantastika', 'kriminal', 'detektiv', 'anime', 'multfilm',
  'sarguzasht', 'ujas', 'biografik', 'tarixiy', 'musiqiy',
];

const http = axios.create({
  baseURL: BASE,
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
    'DNT': '1',
  },
});

async function fetchHtml(path) {
  try {
    const { data } = await http.get(path);
    return data;
  } catch (err) {
    const status = err.response?.status;
    const msg = status ? `asilmedia.org returned ${status} for "${path}"` : `Network error: ${err.message}`;
    throw Object.assign(new Error(msg), { status: status || 502 });
  }
}

// Parse article.card elements
function parseCards(html) {
  const $ = cheerio.load(html);
  const items = [];

  $('article.card').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a.card__link');
    const href = $link.attr('href') || '';
    if (!href) return;

    const idMatch = href.match(/\/(\d+)-/);
    if (!idMatch) return;

    const externalId = idMatch[1];
    const url = href.startsWith('http') ? href : `${BASE}${href}`;
    const slugMatch = href.match(/\/\d+-(.+?)\.html/);

    const imgEl = $el.find('img.img-cover');
    const imgSrc = imgEl.attr('src') || imgEl.attr('data-src') || '';
    const thumbnail = imgSrc
      ? (imgSrc.startsWith('http') ? imgSrc : `${BASE}${imgSrc}`)
      : null;

    const title = $el.find('h2.card__title').text().trim()
      || imgEl.attr('alt') || $link.attr('title') || '';

    // Rating: text like "+7", "0", "-2"
    const ratingRaw = $el.find('.ratingtypeplusminus').text().trim();
    const rating = parseInt(ratingRaw) || 0;

    // Qualities: badge--hd (1080p) and badge--quality (720p, 480p, ...)
    const qualities = [];
    $el.find('.badge--hd, .badge--quality').each((_, b) => {
      const q = $(b).text().trim();
      if (q) qualities.push(q);
    });

    // Year from meta link
    const $meta = $el.find('.card__meta');
    const yearText = $meta.find('a[href*="/xfsearch/year/"]').text().trim();
    const categoryText = $meta.find('span').first().text().trim();

    items.push({
      externalId,
      title,
      slug: slugMatch ? slugMatch[1] : '',
      url,
      thumbnail,
      year: yearText ? parseInt(yearText) || null : null,
      rating,
      qualities,
      category: categoryText || null,
    });
  });

  return items;
}

// Parse total pages from div.pagination
function parseTotalPages(html) {
  const $ = cheerio.load(html);
  let max = 1;
  $('div.pagination a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/page\/(\d+)\//);
    if (m) {
      const n = parseInt(m[1]);
      if (n > max) max = n;
    }
    // Also check link text as page number
    const text = parseInt($(el).text().trim());
    if (!isNaN(text) && text > max) max = text;
  });
  return max;
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function getLatest(page = 1) {
  const path = page > 1 ? `/page/${page}/` : '/';
  const html = await fetchHtml(path);
  return {
    items: parseCards(html),
    page: Number(page),
    totalPages: parseTotalPages(html),
  };
}

async function getCategory(category, page = 1) {
  const catPath = CATEGORIES[category];
  if (!catPath) {
    throw Object.assign(
      new Error(`Unknown category "${category}". Valid: ${Object.keys(CATEGORIES).join(', ')}`),
      { status: 400 }
    );
  }
  const path = page > 1 ? `/${catPath}/page/${page}/` : `/${catPath}/`;
  const html = await fetchHtml(path);
  return {
    items: parseCards(html),
    category,
    page: Number(page),
    totalPages: parseTotalPages(html),
  };
}

async function getGenre(genre, page = 1) {
  const path = page > 1
    ? `/xfsearch/genre/${genre}/page/${page}/`
    : `/xfsearch/genre/${genre}/`;
  const html = await fetchHtml(path);
  return {
    items: parseCards(html),
    genre,
    page: Number(page),
    totalPages: parseTotalPages(html),
  };
}

async function getYear(year, page = 1) {
  const path = page > 1
    ? `/xfsearch/year/${year}/page/${page}/`
    : `/xfsearch/year/${year}/`;
  const html = await fetchHtml(path);
  return {
    items: parseCards(html),
    year: Number(year),
    page: Number(page),
    totalPages: parseTotalPages(html),
  };
}

async function search(query, page = 1) {
  const start = (Number(page) - 1) * 10;
  const path = `/?do=search&subaction=search&search_start=${start}&full_search=0&story=${encodeURIComponent(query)}`;
  const html = await fetchHtml(path);
  return {
    items: parseCards(html),
    query,
    page: Number(page),
    totalPages: parseTotalPages(html),
  };
}

async function getDetail(url) {
  if (!url || !url.startsWith('http')) {
    throw Object.assign(new Error('Valid absolute URL required'), { status: 400 });
  }
  const path = url.replace(BASE, '');
  const html = await fetchHtml(path);
  const $ = cheerio.load(html);

  const title = $('h1[itemprop="name"], .full-title, h1.short-title, h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content') || '';

  const thumbnail = $('meta[property="og:image"]').attr('content')
    || $('.card__poster img, .full-poster img, .poster img').first().attr('src') || null;

  const description = $('[itemprop="description"], .full-text, .short-story-text, .full-story-short-s').first().text().trim()
    || $('meta[name="description"]').attr('content') || null;

  const genres = [];
  $('a[href*="/xfsearch/genre/"]').each((_, el) => {
    const g = $(el).text().trim();
    if (g) genres.push(g.toLowerCase());
  });

  const cast = [];
  $('a[href*="/xfsearch/actor/"]').each((_, el) => {
    const name = $(el).text().trim();
    if (name) cast.push(name);
  });

  const qualities = [];
  $('a[href*="/xfsearch/quality/"], .badge--hd, .badge--quality').each((_, el) => {
    const q = $(el).text().trim();
    if (q) qualities.push(q);
  });

  const yearText = $('a[href*="/xfsearch/year/"]').first().text().trim();
  const ratingRaw = $('[itemprop="ratingValue"], .ratingtypeplusminus').first().text().trim();
  const duration = $('a[href*="/xfsearch/duration/"], [itemprop="duration"]').first().text().trim() || null;
  const country = $('a[href*="/xfsearch/world/"]').first().text().trim() || null;
  const director = $('a[href*="/xfsearch/director/"]').first().text().trim() || null;

  // Video player src — iframe or video tag
  const playerSrc = $('iframe[src*="//"], iframe[data-src*="//"]').first().attr('src')
    || $('iframe[src*="//"], iframe[data-src*="//"]').first().attr('data-src')
    || null;

  return {
    title,
    description,
    thumbnail: thumbnail?.startsWith('http') ? thumbnail : thumbnail ? `${BASE}${thumbnail}` : null,
    year: yearText ? parseInt(yearText) || null : null,
    rating: parseInt(ratingRaw) || 0,
    genres: [...new Set(genres)],
    cast: [...new Set(cast)].slice(0, 20),
    qualities: [...new Set(qualities)],
    country,
    director,
    duration,
    playerSrc,
    url,
  };
}

function getCategoryList() {
  return Object.keys(CATEGORIES).map((slug) => ({
    slug,
    path: CATEGORIES[slug],
    url: `${BASE}/${CATEGORIES[slug]}/`,
  }));
}

function getGenreList() {
  return GENRES.map((genre) => ({
    slug: genre,
    url: `${BASE}/xfsearch/genre/${genre}/`,
  }));
}

module.exports = { getLatest, getCategory, getGenre, getYear, search, getDetail, getCategoryList, getGenreList };
