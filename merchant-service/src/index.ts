import express, { Request, Response } from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8002;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/biteswift_merchant';

app.use(cors());
app.use(express.json());

// Log middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[MERCHANT-SERVICE] ${req.method} ${req.originalUrl} - ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Schema definition
interface MenuItem {
  _id: mongoose.Types.ObjectId;
  name: string;
  description: string;
  price: number;
  image: string;
  isAvailable: boolean;
}

interface IMerchant {
  name: string;
  description: string;
  address: string;
  phone: string;
  image: string;
  isActive: boolean;
  menu: MenuItem[];
}

const MenuItemSchema = new mongoose.Schema<MenuItem>({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true },
  image: { type: String, default: '' },
  isAvailable: { type: Boolean, default: true }
});

const MerchantSchema = new mongoose.Schema<IMerchant>({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  address: { type: String, required: true },
  phone: { type: String, required: true },
  image: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  menu: [MenuItemSchema]
});

const Merchant = mongoose.model<IMerchant>('Merchant', MerchantSchema);

// Connect to MongoDB with retry mechanism
const connectMongoDB = async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      await mongoose.connect(MONGO_URI);
      console.log('[MERCHANT-SERVICE] Connected to MongoDB successfully.');
      await seedData();
      break;
    } catch (err) {
      retries -= 1;
      console.error(`[MERCHANT-SERVICE] MongoDB connection failed. Retries left: ${retries}. Error: ${(err as Error).message}`);
      if (retries === 0) {
        console.error('[MERCHANT-SERVICE] Could not connect to MongoDB. Exiting...');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Seed initial data if empty
const seedData = async () => {
  try {
    const count = await Merchant.countDocuments();
    if (count === 0) {
      console.log('[MERCHANT-SERVICE] Seeding initial restaurants...');
      
      const seedRestaurants = [
        {
          name: 'Cơm Tấm Phúc Lộc Thọ',
          description: 'Cơm tấm chuẩn vị Sài Gòn, thương hiệu lâu đời, cam kết vệ sinh an toàn thực phẩm.',
          address: '236 Đinh Bộ Lĩnh, Phường 26, Bình Thạnh, TP.HCM',
          phone: '1900 6552',
          image: 'https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?q=80&w=400&auto=format&fit=crop',
          isActive: true,
          menu: [
            {
              name: 'Cơm Tấm Sườn Bì Chả',
              description: 'Cơm tấm dẻo thơm ăn kèm sườn nướng mật ong thơm lừng, bì dai giòn, chả chưng trứng và nước mắm chua ngọt.',
              price: 45000,
              image: 'https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?q=80&w=200&auto=format&fit=crop',
              isAvailable: true
            },
            {
              name: 'Cơm Đùi Gà Nướng Ngũ Vị',
              description: 'Đùi gà lớn ướp ngũ vị hương nướng vàng ruộm, thịt mềm ngọt mọng nước.',
              price: 49000,
              image: 'https://images.unsplash.com/photo-1598515214211-89d3e73ae83b?q=80&w=200&auto=format&fit=crop',
              isAvailable: true
            },
            {
              name: 'Nước Sâm La Hán Quả',
              description: 'Nước sâm thanh mát tự nấu từ sâm đất và la hán quả ngọt dịu.',
              price: 12000,
              image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?q=80&w=200&auto=format&fit=crop',
              isAvailable: true
            }
          ]
        },
        {
          name: 'Bánh Mì Huỳnh Hoa',
          description: 'Bánh mì đắt nhất Sài Gòn nhưng ngập tràn topping bơ, pate siêu béo thơm ngon nức tiếng.',
          address: '26 Lê Thị Riêng, Phường Bến Thành, Quận 1, TP.HCM',
          phone: '090 666 5543',
          image: 'https://images.unsplash.com/photo-1509722747041-616f39b57569?q=80&w=400&auto=format&fit=crop',
          isActive: true,
          menu: [
            {
              name: 'Bánh Mì Đặc Biệt (Ổ Lớn)',
              description: 'Trọng lượng gần 500g, ngập tràn chả lụa, chả bò, thịt nguội, pate và sốt bơ trứng gà đặc trưng.',
              price: 68000,
              image: 'https://images.unsplash.com/photo-1509722747041-616f39b57569?q=80&w=200&auto=format&fit=crop',
              isAvailable: true
            },
            {
              name: 'Bánh Mì Xá Xíu Bơ Tỏi',
              description: 'Bánh mì giòn nóng hổi ăn kèm thịt xá xíu đậm đà và sốt bơ tỏi thơm lừng.',
              price: 48000,
              image: 'https://images.unsplash.com/photo-1549611016-3a70d82b5040?q=80&w=200&auto=format&fit=crop',
              isAvailable: true
            },
            {
              name: 'Hồng Trà Sữa Thái',
              description: 'Hồng trà pha trà sữa béo ngậy ăn kèm thạch giòn.',
              price: 25000,
              image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?q=80&w=200&auto=format&fit=crop',
              isAvailable: true
            }
          ]
        }
      ];

      await Merchant.insertMany(seedRestaurants);
      console.log('[MERCHANT-SERVICE] Seeded: Cơm Tấm Phúc Lộc Thọ, Bánh Mì Huỳnh Hoa.');
    }
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error seeding database:', error);
  }
};

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ service: 'Merchant & Menu Service', status: 'UP', timestamp: new Date() });
});

// GET all merchants
app.get('/merchants', async (req: Request, res: Response) => {
  try {
    const merchants = await Merchant.find({ isActive: true });
    return res.status(200).json(merchants);
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error getting merchants:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET merchant by ID (including menu)
app.get('/merchants/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid merchant ID format' });
    }
    const merchant = await Merchant.findById(id);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    return res.status(200).json(merchant);
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error getting merchant by ID:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST create a merchant
app.post('/merchants', async (req: Request, res: Response) => {
  const { name, description, address, phone, image } = req.body;
  if (!name || !address || !phone) {
    return res.status(400).json({ error: 'Missing required fields (name, address, phone)' });
  }

  try {
    const newMerchant = new Merchant({
      name,
      description,
      address,
      phone,
      image,
      isActive: true,
      menu: []
    });
    await newMerchant.save();
    return res.status(201).json(newMerchant);
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error creating merchant:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PUT update a merchant
app.put('/merchants/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, address, phone, image, isActive } = req.body;

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid merchant ID format' });
    }

    const updatedMerchant = await Merchant.findByIdAndUpdate(
      id,
      {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(image !== undefined && { image }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) })
      },
      { new: true, runValidators: true }
    );

    if (!updatedMerchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    return res.status(200).json(updatedMerchant);
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error updating merchant:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE a merchant
app.delete('/merchants/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid merchant ID format' });
    }

    const deletedMerchant = await Merchant.findByIdAndDelete(id);
    if (!deletedMerchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    return res.status(200).json({ message: 'Merchant deleted successfully', merchant: deletedMerchant });
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error deleting merchant:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST add dish to merchant menu
app.post('/menus/:merchantId/items', async (req: Request, res: Response) => {
  const { merchantId } = req.params;
  const { name, description, price, image } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Missing required fields (name, price)' });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(merchantId)) {
      return res.status(400).json({ error: 'Invalid merchant ID format' });
    }

    const merchant = await Merchant.findById(merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    const newItem = {
      _id: new mongoose.Types.ObjectId(),
      name,
      description,
      price: Number(price),
      image: image || '',
      isAvailable: true
    } as MenuItem;

    merchant.menu.push(newItem);
    await merchant.save();

    return res.status(201).json(newItem);
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error adding menu item:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PUT update a menu item
app.put('/menus/:merchantId/items/:itemId', async (req: Request, res: Response) => {
  const { merchantId, itemId } = req.params;
  const { name, description, price, image, isAvailable } = req.body;

  try {
    if (!mongoose.Types.ObjectId.isValid(merchantId) || !mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ error: 'Invalid merchant or item ID format' });
    }

    const merchant = await Merchant.findById(merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    const item = merchant.menu.find(i => i._id.toString() === itemId);
    if (!item) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    if (name !== undefined) item.name = name;
    if (description !== undefined) item.description = description;
    if (price !== undefined) item.price = Number(price);
    if (image !== undefined) item.image = image;
    if (isAvailable !== undefined) item.isAvailable = Boolean(isAvailable);

    await merchant.save();
    return res.status(200).json(item);
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error updating menu item:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE a menu item
app.delete('/menus/:merchantId/items/:itemId', async (req: Request, res: Response) => {
  const { merchantId, itemId } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(merchantId) || !mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ error: 'Invalid merchant or item ID format' });
    }

    const merchant = await Merchant.findById(merchantId);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    const initialLength = merchant.menu.length;
    merchant.menu = merchant.menu.filter(i => i._id.toString() !== itemId);
    if (merchant.menu.length === initialLength) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    await merchant.save();
    return res.status(200).json({ message: 'Menu item deleted successfully', itemId });
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error deleting menu item:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Internal endpoint: GET specific menu item detail across ALL merchants (used by Order Service to verify cart items)
app.get('/menus/items/:itemId', async (req: Request, res: Response) => {
  const { itemId } = req.params;
  try {
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ error: 'Invalid item ID format' });
    }

    // Find the merchant that owns this item using mongoose $elemMatch
    const merchant = await Merchant.findOne({ 'menu._id': new mongoose.Types.ObjectId(itemId) });
    if (!merchant) {
      return res.status(404).json({ error: 'Item not found in any merchant menus' });
    }

    // Find the actual item in the array
    const item = merchant.menu.find(i => i._id.toString() === itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    return res.status(200).json({
      item,
      merchant: {
        id: merchant._id,
        name: merchant.name,
        address: merchant.address
      }
    });
  } catch (error) {
    console.error('[MERCHANT-SERVICE] Error looking up menu item:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, async () => {
  await connectMongoDB();
  console.log(`[MERCHANT-SERVICE] Merchant Service is running on port ${PORT}`);
});
