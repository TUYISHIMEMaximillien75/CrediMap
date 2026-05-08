const express = require('express');
const router  = express.Router();
const path    = require('path');
const { Op }  = require('sequelize');
const { Product, User } = require('../models');
const authMiddleware = require('../middleware/auth');
const upload         = require('../middleware/upload');

// POST /api/products/upload — upload a product image, returns its URL
// Must be placed BEFORE any /:id route to avoid route conflict
router.post(
  '/upload',
  authMiddleware,
  upload.single('image'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const imageUrl = `/uploads/products/${req.file.filename}`;
    res.json({ imageUrl, message: 'Image uploaded successfully' });
  }
);

// GET /api/products — public, filterable by category, price, minTrust, search, page
router.get('/', async (req, res) => {
  try {
    const { category, minPrice, maxPrice, minTrust, search, page = 1, limit = 9, showSold = 'false' } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10)));

    const productConditions = {};
    // Only show sold items if explicitly requested
    if (showSold !== 'true') productConditions.status = 'available';
    if (category) productConditions.category = category;
    if (search)   productConditions.title = { [Op.like]: `%${search}%` };
    if (minPrice || maxPrice) {
      productConditions.price = {};
      if (minPrice) productConditions.price[Op.gte] = parseFloat(minPrice);
      if (maxPrice) productConditions.price[Op.lte] = parseFloat(maxPrice);
    }

    const sellerConditions = {};
    if (minTrust) sellerConditions.trustScore = { [Op.gte]: parseInt(minTrust, 10) };

    const { count, rows: products } = await Product.findAndCountAll({
      where: productConditions,
      include: [{
        model: User, as: 'seller',
        where: sellerConditions,
        attributes: ['id', 'name', 'trustScore', 'phone', 'isVerified'],
        required: !!minTrust,
      }],
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    res.json({
      products,
      totalCount: count,
      page: pageNum,
      hasMore: pageNum * limitNum < count,
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/products — any authenticated user can post an item for sale
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, description, price, category, categoryRiskFactor } = req.body;

    if (!title || !price || !category)
      return res.status(400).json({ error: 'Title, price and category are required' });

    const product = await Product.create({
      title,
      description: description || '',
      price: parseFloat(price),
      category,
      categoryRiskFactor: categoryRiskFactor || 1.0,
      sellerId: req.user.id,
    });

    const productWithSeller = await Product.findByPk(product.id, {
      include: [{ model: User, as: 'seller', attributes: ['id', 'name', 'trustScore'] }]
    });

    res.status(201).json({ message: 'Product listed successfully', product: productWithSeller });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/my — seller's own listings (must come before /:id)
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const products = await Product.findAll({
      where: { sellerId: req.user.id },
      order: [['createdAt', 'DESC']],
    });
    res.json({ products });
  } catch (err) {
    console.error('Error fetching own products:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/:id — single product detail
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id, {
      include: [{ model: User, as: 'seller', attributes: ['id', 'name', 'trustScore', 'isVerified'] }]
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ product });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/products/:id — seller edits their own listing
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.sellerId !== req.user.id && !req.user.isAdmin)
      return res.status(403).json({ error: 'Not authorized to edit this listing' });

    const { title, description, price, category } = req.body;
    const RISK_FACTORS = { Electronics: 1.8, Furniture: 1.4, Books: 0.6, Apparel: 0.8, Sports: 1.0, Music: 1.2, General: 1.0 };

    if (title)       product.title       = title;
    if (description !== undefined) product.description = description;
    if (price)       product.price       = parseFloat(price);
    if (category) {
      product.category           = category;
      product.categoryRiskFactor = RISK_FACTORS[category] || 1.0;
    }
    await product.save();

    res.json({ message: 'Listing updated', product });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/products/:id/status — seller toggles available/sold
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.sellerId !== req.user.id)
      return res.status(403).json({ error: 'Not authorized' });

    const { status } = req.body;
    if (!['available', 'sold'].includes(status))
      return res.status(400).json({ error: 'Status must be \'available\' or \'sold\'' });

    product.status = status;
    await product.save();
    res.json({ message: `Listing marked as ${status}`, product });
  } catch (err) {
    console.error('Status update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/products/:id — seller can delete their own listing
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.sellerId !== req.user.id && !req.user.isAdmin)
      return res.status(403).json({ error: 'Not authorized to delete this listing' });

    await product.destroy();
    res.json({ message: 'Listing removed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
