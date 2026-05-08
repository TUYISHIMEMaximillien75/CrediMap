/**
 * middleware/sanitize.js
 * Lightweight input sanitization — trims strings and strips HTML tags.
 * Applied to req.body before route handlers to prevent XSS via stored text.
 */

const STRIP_HTML = /<[^>]*>/g;

/**
 * Recursively sanitize a value:
 *  - Strings: trim + strip HTML tags
 *  - Objects: sanitize each value
 *  - Arrays:  sanitize each element
 *  - Numbers / booleans / null: pass through unchanged
 */
function sanitizeValue(val) {
  if (typeof val === 'string') {
    return val.trim().replace(STRIP_HTML, '');
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeValue);
  }
  if (val !== null && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return val;
}

/**
 * Express middleware — sanitizes req.body in place.
 * Skips if Content-Type is multipart (file uploads use raw buffer).
 */
function sanitizeBody(req, _res, next) {
  if (req.body && !req.is('multipart/form-data')) {
    req.body = sanitizeValue(req.body);
  }
  next();
}

module.exports = sanitizeBody;
