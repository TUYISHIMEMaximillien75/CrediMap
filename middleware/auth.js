const jwt = require('jsonwebtoken');
require('dotenv').config();

/**
 * Verifies the JWT in the Authorization header and attaches
 * the decoded user payload (id, isAdmin) to req.user.
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token, authorization denied' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user; // { id, isAdmin }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token is not valid or has expired' });
  }
};

module.exports = authMiddleware;
