/**
 * DEMO CATALOG SEED - not production data.
 *
 * Creates exactly 5 products per existing subcategory (5 * 100 = 500
 * products), each with 2-4 generated placeholder images uploaded through the
 * real, unmodified media-upload pipeline (MediaUploadService: MIME
 * allowlist -> magic-byte check -> sharp decode -> storage write), and
 * initializes real inventory through InventoryService. Everything goes
 * through the actual NestJS services (ProductsService, ProductImagesService,
 * InventoryService), not raw SQL, so every existing business rule/validation/
 * audit-log path applies exactly as it would to an admin using the UI.
 *
 * Idempotency: re-running this script is safe. Products are looked up by
 * their deterministic SKU first; if a product with that SKU already exists,
 * it is left untouched (no duplicate, no re-upload) rather than erroring or
 * duplicating images.
 *
 * Run with: npx ts-node prisma/seed-catalog.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProductsService } from '../src/modules/products/products.service';
import { ProductImagesService } from '../src/modules/product-images/product-images.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { AuthenticatedUser } from '../src/modules/auth/types/authenticated-user.type';

// ---------------------------------------------------------------------------
// Product name / price / weight catalog, keyed by subcategory slug (see
// reset-categories.ts for how these subcategories were created).
// ---------------------------------------------------------------------------

interface SubcategorySpec {
  names: [string, string, string, string, string];
  priceRange: [number, number];
  /** Gift cards are fixed-value, not a random range - see below. */
  fixedPrices?: [number, number, number, number, number];
}

interface CategorySpec {
  weightRangeKg: [number, number];
  subcategories: Record<string, SubcategorySpec>;
}

const CATALOG: Record<string, CategorySpec> = {
  "men-s-fashion": {
    weightRangeKg: [0.15, 0.6],
    subcategories: {
      "men-s-fashion-t-shirts-and-polos": {
        names: ['Classic Cotton T-Shirt', 'Premium Pique Polo Shirt', 'Slim Fit Graphic T-Shirt', 'Regular Fit Henley T-Shirt', 'Striped Casual Polo Shirt'],
        priceRange: [399, 1299],
      },
      "men-s-fashion-shirts": {
        names: ['Slim Fit Oxford Shirt', 'Premium Cotton Formal Shirt', 'Checked Casual Shirt', 'Regular Fit Linen Shirt', 'Denim Casual Shirt'],
        priceRange: [599, 1999],
      },
      "men-s-fashion-jeans": {
        names: ['Slim Fit Stretch Jeans', 'Regular Fit Straight Jeans', 'Distressed Skinny Jeans', 'Relaxed Fit Denim Jeans', 'Dark Wash Bootcut Jeans'],
        priceRange: [899, 2499],
      },
      "men-s-fashion-trousers": {
        names: ['Slim Fit Chino Trousers', 'Formal Regular Fit Trousers', 'Cotton Cargo Trousers', 'Tapered Fit Trousers', 'Pleated Formal Trousers'],
        priceRange: [699, 1999],
      },
      "men-s-fashion-jackets": {
        names: ['Quilted Bomber Jacket', 'Classic Denim Jacket', 'Waterproof Windcheater Jacket', 'Leather Biker Jacket', 'Hooded Puffer Jacket'],
        priceRange: [1299, 3999],
      },
    },
  },
  "women-s-fashion": {
    weightRangeKg: [0.15, 0.7],
    subcategories: {
      "women-s-fashion-dresses": {
        names: ['Floral Wrap Dress', 'A-Line Midi Dress', 'Bodycon Party Dress', 'Off-Shoulder Maxi Dress', 'Casual Shirt Dress'],
        priceRange: [799, 2999],
      },
      "women-s-fashion-tops-and-tunics": {
        names: ['Printed Cotton Tunic', 'Ruffle Sleeve Top', 'Crop Top with Tie-Up', 'Embroidered Kurti Top', 'Flowy Georgette Top'],
        priceRange: [499, 1799],
      },
      "women-s-fashion-sarees": {
        names: ['Banarasi Silk Saree', 'Printed Georgette Saree', 'Chiffon Party Wear Saree', 'Cotton Handloom Saree', 'Embellished Net Saree'],
        priceRange: [999, 4999],
      },
      "women-s-fashion-kurtas-and-suits": {
        names: ['Embroidered Anarkali Suit', 'Cotton Straight Kurta', 'Printed Palazzo Suit Set', 'Chikankari Kurta Set', 'Designer Sharara Suit'],
        priceRange: [899, 3499],
      },
      "women-s-fashion-leggings": {
        names: ['Ankle-Length Cotton Leggings', 'High-Waist Stretch Leggings', 'Printed Churidar Leggings', 'Solid Color Jeggings', 'Patterned Yoga Leggings'],
        priceRange: [349, 999],
      },
    },
  },
  "kids-fashion": {
    weightRangeKg: [0.1, 0.4],
    subcategories: {
      "kids-fashion-boys-clothing": {
        names: ['Printed Cotton T-Shirt for Boys', 'Boys Denim Shorts Set', 'Casual Boys Shirt', 'Boys Track Suit', 'Boys Ethnic Kurta Set'],
        priceRange: [299, 999],
      },
      "kids-fashion-girls-clothing": {
        names: ['Floral Frock for Girls', 'Girls Party Wear Dress', 'Cotton Leggings Set for Girls', 'Girls Denim Dungaree', 'Ethnic Lehenga Set for Girls'],
        priceRange: [349, 1299],
      },
      "kids-fashion-infant-wear": {
        names: ['Soft Cotton Infant Bodysuit', 'Newborn Sleepsuit Set', 'Infant Romper with Cap', 'Organic Cotton Baby Onesie', 'Infant Swaddle Wrap Set'],
        priceRange: [249, 799],
      },
      "kids-fashion-school-uniforms": {
        names: ['Cotton School Shirt Set', 'Pleated School Skirt', 'School Uniform Trousers', 'School PT T-Shirt Set', 'Winter School Sweater'],
        priceRange: [399, 1199],
      },
      "kids-fashion-kids-footwear": {
        names: ['Kids Casual Sneakers', 'Velcro School Shoes', 'Kids Sandals', 'Light-Up Sports Shoes for Kids', 'Kids Flip Flops'],
        priceRange: [399, 1299],
      },
    },
  },
  "home-and-kitchen": {
    weightRangeKg: [0.3, 3.5],
    subcategories: {
      "home-and-kitchen-cookware": {
        names: ['Non-Stick Frying Pan', 'Stainless Steel Cookware Set', 'Cast Iron Skillet', 'Pressure Cooker', 'Ceramic Coated Saucepan'],
        priceRange: [499, 3499],
      },
      "home-and-kitchen-dinnerware": {
        names: ['Bone China Dinner Set', 'Ceramic Dinner Plate Set', 'Melamine Dinnerware Set', 'Stoneware Bowl Set', 'Porcelain Serving Platter'],
        priceRange: [599, 2999],
      },
      "home-and-kitchen-storage-and-containers": {
        names: ['Airtight Food Storage Set', 'Stackable Kitchen Containers', 'Glass Storage Jar Set', 'Modular Fridge Organizer Set', 'Vacuum Seal Storage Containers'],
        priceRange: [299, 1499],
      },
      "home-and-kitchen-home-decor": {
        names: ['Wall Hanging Wooden Clock', 'Decorative Table Lamp', 'Handcrafted Wall Art Panel', 'Ceramic Flower Vase', 'LED Fairy String Lights'],
        priceRange: [399, 2499],
      },
      "home-and-kitchen-bedding": {
        names: ['Cotton Bedsheet Set', 'Quilted Comforter Set', 'Microfiber Pillow Covers', 'Reversible Duvet Cover Set', 'Memory Foam Mattress Topper'],
        priceRange: [699, 3499],
      },
    },
  },
  "electronics": {
    weightRangeKg: [0.3, 12],
    subcategories: {
      "electronics-televisions": {
        names: ['43-inch 4K Smart TV', '55-inch Ultra HD LED TV', '32-inch HD Ready LED TV', '65-inch QLED Smart TV', '50-inch Android Smart TV'],
        priceRange: [12999, 54999],
      },
      "electronics-laptops": {
        names: ['14-inch Ultra-Slim Laptop', '15.6-inch Performance Laptop', '13-inch Convertible Laptop', 'Business Ultrabook Laptop', 'Gaming Laptop with Discrete Graphics'],
        priceRange: [29999, 79999],
      },
      "electronics-cameras": {
        names: ['Mirrorless Digital Camera', 'DSLR Camera with Kit Lens', 'Compact Point-and-Shoot Camera', 'Waterproof Action Camera', 'Instant Print Camera'],
        priceRange: [8999, 49999],
      },
      "electronics-speakers-and-audio": {
        names: ['Portable Bluetooth Speaker', 'Soundbar with Subwoofer', 'Wireless Party Speaker', 'Home Theatre Speaker System', 'Smart Speaker with Voice Assistant'],
        priceRange: [1499, 12999],
      },
      "electronics-smart-home": {
        names: ['Smart Wi-Fi Security Camera', 'Smart LED Bulb Pack', 'Smart Video Doorbell', 'Smart Plug with App Control', 'Smart Home Hub'],
        priceRange: [999, 6999],
      },
    },
  },
  "mobile-accessories": {
    weightRangeKg: [0.02, 0.5],
    subcategories: {
      "mobile-accessories-cases-and-covers": {
        names: ['Shockproof Phone Back Cover', 'Transparent Silicone Phone Case', 'Leather Flip Phone Cover', 'Rugged Armor Phone Case', 'Slim Fit Phone Case'],
        priceRange: [149, 799],
      },
      "mobile-accessories-chargers-and-cables": {
        names: ['Fast Charging USB-C Cable', '20W Wall Charger Adapter', 'Braided Lightning Cable', 'Multi-Port Charging Cable', 'Car Charger with Dual USB'],
        priceRange: [199, 999],
      },
      "mobile-accessories-power-banks": {
        names: ['10000mAh Portable Power Bank', '20000mAh Fast Charging Power Bank', 'Slim Compact Power Bank', 'Wireless Charging Power Bank', 'Solar Power Bank'],
        priceRange: [699, 2499],
      },
      "mobile-accessories-screen-protectors": {
        names: ['Tempered Glass Screen Protector', 'Privacy Screen Guard', 'Anti-Glare Screen Protector', 'Full Coverage Edge Screen Guard', 'Matte Finish Screen Protector'],
        priceRange: [99, 499],
      },
      "mobile-accessories-bluetooth-devices": {
        names: ['True Wireless Bluetooth Earbuds', 'Bluetooth Neckband Earphones', 'Bluetooth Car Adapter', 'Wireless Bluetooth Headset', 'Bluetooth Smart Watch'],
        priceRange: [999, 4999],
      },
    },
  },
  "beauty-and-health": {
    weightRangeKg: [0.05, 0.6],
    subcategories: {
      "beauty-and-health-skincare": {
        names: ['Vitamin C Face Serum', 'Hydrating Face Moisturizer', 'Charcoal Face Wash', 'Aloe Vera Soothing Gel', 'Sunscreen SPF 50 Lotion'],
        priceRange: [199, 1299],
      },
      "beauty-and-health-haircare": {
        names: ['Anti-Dandruff Shampoo', 'Argan Oil Hair Conditioner', 'Hair Growth Serum', 'Keratin Hair Mask', 'Herbal Hair Oil'],
        priceRange: [199, 1199],
      },
      "beauty-and-health-makeup": {
        names: ['Matte Liquid Lipstick', 'Long-Wear Foundation', 'Waterproof Kajal', 'Compact Face Powder', 'Eyeshadow Palette'],
        priceRange: [249, 1499],
      },
      "beauty-and-health-personal-care": {
        names: ['Body Wash Shower Gel', 'Deodorant Roll-On', 'Electric Hair Trimmer', 'Talc-Free Body Powder', 'Moisturizing Hand Cream'],
        priceRange: [149, 999],
      },
      "beauty-and-health-health-supplements": {
        names: ['Multivitamin Tablets', 'Whey Protein Powder', 'Omega-3 Fish Oil Capsules', 'Biotin Hair & Skin Supplement', 'Herbal Immunity Booster'],
        priceRange: [349, 1999],
      },
    },
  },
  "automotive": {
    weightRangeKg: [0.2, 6],
    subcategories: {
      "automotive-car-accessories": {
        names: ['Car Dashboard Camera', 'Car Seat Cover Set', 'Car Phone Mount Holder', 'Car Air Freshener Set', 'Car Floor Mats Set'],
        priceRange: [299, 2999],
      },
      "automotive-bike-accessories": {
        names: ['Bike Mobile Holder', 'Bike Saddle Cover', 'Bike LED Headlight', 'Bike Riding Gloves', 'Waterproof Bike Cover'],
        priceRange: [199, 1499],
      },
      "automotive-car-care": {
        names: ['Car Wash Shampoo', 'Car Wax Polish', 'Microfiber Cleaning Cloth Set', 'Tyre Shine Spray', 'Car Interior Cleaner'],
        priceRange: [199, 999],
      },
      "automotive-helmets": {
        names: ['Full Face Riding Helmet', 'Half Face Helmet with Visor', 'Modular Flip-Up Helmet', 'Open Face Helmet', 'Kids Riding Helmet'],
        priceRange: [999, 3999],
      },
      "automotive-tyres-and-wheels": {
        names: ['Tubeless Bike Tyre', 'Alloy Wheel Cover Set', 'Car Tyre Inflator', 'Wheel Rim Sticker Set', 'All-Terrain Tyre'],
        priceRange: [799, 4999],
      },
    },
  },
  "sports-and-fitness": {
    weightRangeKg: [0.2, 8],
    subcategories: {
      "sports-and-fitness-gym-equipment": {
        names: ['Adjustable Dumbbell Set', 'Resistance Bands Set', 'Foldable Treadmill', 'Yoga Mat with Carry Strap', 'Speed Skipping Rope'],
        priceRange: [499, 4999],
      },
      "sports-and-fitness-sportswear": {
        names: ['Dry-Fit Sports T-Shirt', 'Performance Track Pants', 'Compression Fit Shorts', 'Sports Sweatshirt', 'Moisture-Wicking Tank Top'],
        priceRange: [399, 1499],
      },
      "sports-and-fitness-cycling": {
        names: ['Mountain Bike Helmet', 'Cycling Gloves', 'Bike Water Bottle Holder', 'Cycling Jersey', 'Bike Repair Tool Kit'],
        priceRange: [299, 2999],
      },
      "sports-and-fitness-yoga-and-meditation": {
        names: ['Non-Slip Yoga Mat', 'Yoga Block Set', 'Meditation Cushion', 'Yoga Stretching Strap', 'Yoga Wheel'],
        priceRange: [299, 1499],
      },
      "sports-and-fitness-outdoor-sports": {
        names: ['Badminton Racket Set', 'Football Size 5', 'Cricket Bat Kashmir Willow', 'Table Tennis Paddle Set', 'Basketball Size 7'],
        priceRange: [399, 2499],
      },
    },
  },
  "books-and-stationery": {
    weightRangeKg: [0.1, 0.8],
    subcategories: {
      "books-and-stationery-fiction": {
        names: ['Contemporary Fiction Novel', 'Mystery Thriller Paperback', 'Romance Fiction Bestseller', 'Historical Fiction Novel', 'Fantasy Adventure Novel'],
        priceRange: [199, 599],
      },
      "books-and-stationery-non-fiction": {
        names: ['Self-Help Motivational Book', 'Biography Paperback', 'Personal Finance Guide Book', 'Popular History Book', 'Popular Science Book'],
        priceRange: [249, 799],
      },
      "books-and-stationery-notebooks-and-diaries": {
        names: ['Hardbound Ruled Notebook', 'Spiral Bound Notebook Set', 'Leather Cover Diary', 'Pocket Notebook Pack', 'A5 Dotted Journal'],
        priceRange: [99, 499],
      },
      "books-and-stationery-office-supplies": {
        names: ['Gel Pen Set', 'Stapler with Pins', 'Sticky Notes Pack', 'Desk Organizer Tray', 'Whiteboard Marker Set'],
        priceRange: [79, 599],
      },
      "books-and-stationery-art-supplies": {
        names: ['Acrylic Paint Set', 'Sketch Pencil Set', 'Watercolor Paint Kit', 'Canvas Board Pack', 'Oil Pastel Set'],
        priceRange: [149, 1299],
      },
    },
  },
  "groceries": {
    weightRangeKg: [0.1, 2],
    subcategories: {
      "groceries-fruits-and-vegetables": {
        names: ['Fresh Seasonal Fruit Box', 'Organic Vegetable Combo Pack', 'Fresh Leafy Greens Pack', 'Exotic Fruit Basket', 'Farm Fresh Vegetable Pack'],
        priceRange: [99, 599],
      },
      "groceries-snacks-and-beverages": {
        names: ['Roasted Namkeen Mix', 'Masala Potato Chips Pack', 'Instant Coffee Jar', 'Mixed Fruit Juice Pack', 'Energy Drink Pack'],
        priceRange: [49, 399],
      },
      "groceries-staples": {
        names: ['Basmati Rice Pack', 'Whole Wheat Atta Pack', 'Toor Dal Pack', 'Cooking Oil Bottle', 'Refined Sugar Pack'],
        priceRange: [99, 999],
      },
      "groceries-dairy-and-bakery": {
        names: ['Fresh Toned Milk Pack', 'Brown Bread Loaf', 'Paneer Block Pack', 'Salted Butter Block', 'Flavored Yogurt Cups'],
        priceRange: [39, 299],
      },
      "groceries-packaged-foods": {
        names: ['Instant Noodles Pack', 'Ready-to-Eat Meal Pack', 'Breakfast Cereal Box', 'Durum Wheat Pasta Pack', 'Frozen Snacks Pack'],
        priceRange: [49, 399],
      },
    },
  },
  "furniture": {
    weightRangeKg: [8, 45],
    subcategories: {
      "furniture-living-room": {
        names: ['3-Seater Fabric Sofa', 'Wooden Coffee Table', 'TV Entertainment Unit', 'Recliner Chair', 'Wooden Bookshelf Cabinet'],
        priceRange: [4999, 29999],
      },
      "furniture-bedroom": {
        names: ['Queen Size Bed Frame', 'Wooden Wardrobe', 'Bedside Table', 'Dressing Table with Mirror', 'Storage Bed with Drawers'],
        priceRange: [5999, 34999],
      },
      "furniture-office-furniture": {
        names: ['Ergonomic Office Chair', 'Study Table with Drawer', 'Executive Office Desk', 'Metal Filing Cabinet', 'Office Bookcase'],
        priceRange: [2999, 14999],
      },
      "furniture-storage-units": {
        names: ['Multi-Purpose Storage Rack', 'Shoe Storage Cabinet', 'Modular Storage Cubes', 'Plastic Storage Drawer Unit', 'Wall-Mounted Storage Shelf'],
        priceRange: [1499, 7999],
      },
      "furniture-outdoor-furniture": {
        names: ['Outdoor Patio Chair Set', 'Foldable Garden Table', 'Hammock with Stand', 'Outdoor Garden Bench', 'Rattan Outdoor Sofa Set'],
        priceRange: [2999, 17999],
      },
    },
  },
  "jewellery": {
    weightRangeKg: [0.02, 0.15],
    subcategories: {
      "jewellery-earrings": {
        names: ['Gold Plated Stud Earrings', 'Pearl Drop Earrings', 'Oxidized Silver Jhumka Earrings', 'Kundan Chandbali Earrings', 'Minimalist Hoop Earrings'],
        priceRange: [199, 1999],
      },
      "jewellery-necklaces": {
        names: ['Layered Chain Necklace', 'Kundan Choker Necklace', 'Pearl Strand Necklace', 'Temple Design Necklace Set', 'Pendant Necklace with Chain'],
        priceRange: [399, 4999],
      },
      "jewellery-rings": {
        names: ['Gold Plated Adjustable Ring', 'Solitaire Ring', 'Oxidized Statement Ring', 'Stackable Band Rings Set', 'Gemstone Cocktail Ring'],
        priceRange: [299, 2999],
      },
      "jewellery-bracelets": {
        names: ['Charm Bracelet', 'Beaded Bracelet Set', 'Cuff Bracelet', 'Chain Link Bracelet', 'Pearl Bracelet'],
        priceRange: [249, 1999],
      },
      "jewellery-fashion-jewellery": {
        names: ['Oxidized Jewellery Set', 'Kundan Bridal Jewellery Set', 'Beaded Fashion Jewellery Set', 'Antique Gold Jewellery Set', 'Contemporary Jewellery Set'],
        priceRange: [499, 3999],
      },
    },
  },
  "footwear": {
    weightRangeKg: [0.3, 1.2],
    subcategories: {
      "footwear-casual-shoes": {
        names: ['Canvas Slip-On Shoes', 'Casual Lace-Up Sneakers', 'Suede Casual Shoes', 'Loafer Style Casual Shoes', 'Everyday Walking Shoes'],
        priceRange: [799, 2999],
      },
      "footwear-formal-shoes": {
        names: ['Leather Oxford Shoes', 'Formal Derby Shoes', 'Slip-On Formal Loafers', 'Patent Leather Formal Shoes', 'Monk Strap Formal Shoes'],
        priceRange: [1299, 3999],
      },
      "footwear-sports-shoes": {
        names: ['Running Sports Shoes', 'Training Gym Shoes', 'Basketball Sports Shoes', 'Lightweight Walking Shoes', 'Trail Running Shoes'],
        priceRange: [999, 3999],
      },
      "footwear-sandals-and-flip-flops": {
        names: ['Comfort Flip Flops', 'Sports Sandals', 'Casual Slide Sandals', 'Leather Strap Sandals', 'Cushioned Flip Flops'],
        priceRange: [299, 1299],
      },
      "footwear-boots": {
        names: ['Ankle Length Boots', 'Chelsea Boots', 'Combat Boots', 'Waterproof Hiking Boots', 'Suede Desert Boots'],
        priceRange: [1499, 4999],
      },
    },
  },
  "bags-and-luggage": {
    weightRangeKg: [0.3, 3],
    subcategories: {
      "bags-and-luggage-backpacks": {
        names: ['Laptop Backpack', 'Casual College Backpack', 'Waterproof Travel Backpack', 'School Backpack', 'Anti-Theft Backpack'],
        priceRange: [699, 2999],
      },
      "bags-and-luggage-handbags": {
        names: ['Leather Tote Handbag', 'Sling Crossbody Bag', 'Structured Satchel Handbag', 'Quilted Shoulder Bag', 'Evening Clutch Handbag'],
        priceRange: [799, 3999],
      },
      "bags-and-luggage-travel-bags": {
        names: ['Duffel Travel Bag', 'Trolley Suitcase', 'Weekend Travel Bag', 'Foldable Travel Duffel', 'Hard Shell Cabin Luggage'],
        priceRange: [999, 4999],
      },
      "bags-and-luggage-wallets": {
        names: ['Leather Bifold Wallet', 'RFID Blocking Wallet', 'Card Holder Wallet', 'Zip Around Wallet', 'Slim Card Wallet'],
        priceRange: [299, 1499],
      },
      "bags-and-luggage-laptop-bags": {
        names: ['Padded Laptop Sleeve', 'Laptop Messenger Bag', 'Laptop Backpack with USB Port', 'Leather Laptop Briefcase', 'Water-Resistant Laptop Bag'],
        priceRange: [599, 2499],
      },
    },
  },
  "toys-and-games": {
    weightRangeKg: [0.2, 2.5],
    subcategories: {
      "toys-and-games-action-figures": {
        names: ['Superhero Action Figure Set', 'Collectible Action Figure', 'Articulated Action Figure', 'Movie Character Action Figure', 'Action Figure Playset'],
        priceRange: [299, 1999],
      },
      "toys-and-games-educational-toys": {
        names: ['Alphabet Learning Puzzle', 'STEM Building Kit', 'Counting & Numbers Toy Set', 'Interactive Learning Tablet Toy', 'Shape Sorting Toy'],
        priceRange: [399, 1999],
      },
      "toys-and-games-board-games": {
        names: ['Family Strategy Board Game', 'Classic Trivia Board Game', 'Kids Snakes & Ladders Set', 'Word Guessing Board Game', 'Chess and Checkers Set'],
        priceRange: [299, 1499],
      },
      "toys-and-games-outdoor-toys": {
        names: ['Kids Bicycle', 'Water Gun Set', 'Kids Trampoline', 'Ride-On Toy Car', 'Kite Set'],
        priceRange: [499, 4999],
      },
      "toys-and-games-building-blocks": {
        names: ['Interlocking Building Blocks Set', 'Magnetic Building Tiles', 'Wooden Building Blocks Set', 'City Builder Block Set', 'Creative Blocks Mega Pack'],
        priceRange: [399, 2999],
      },
    },
  },
  "pet-supplies": {
    weightRangeKg: [0.2, 3],
    subcategories: {
      "pet-supplies-dog-food": {
        names: ['Adult Dog Dry Food', 'Puppy Growth Formula Food', 'Grain-Free Dog Food', 'Dog Food with Chicken & Rice', 'Senior Dog Dry Food'],
        priceRange: [399, 2499],
      },
      "pet-supplies-cat-food": {
        names: ['Adult Cat Dry Food', 'Kitten Growth Food', 'Grain-Free Cat Food', 'Cat Food with Tuna', 'Indoor Cat Dry Food'],
        priceRange: [349, 1999],
      },
      "pet-supplies-pet-toys": {
        names: ['Squeaky Dog Chew Toy', 'Interactive Cat Toy Wand', 'Rope Tug Toy for Dogs', 'Catnip Toy Set', 'Puzzle Feeder Toy'],
        priceRange: [149, 799],
      },
      "pet-supplies-pet-grooming": {
        names: ['Pet Shampoo & Conditioner', 'Dog Nail Clipper', 'Pet Grooming Brush', 'Pet Deshedding Tool', 'Cat Grooming Glove'],
        priceRange: [199, 1299],
      },
      "pet-supplies-pet-accessories": {
        names: ['Adjustable Pet Collar', 'Pet Leash', 'Pet Travel Carrier', 'Pet Feeding Bowl Set', 'Cozy Pet Bed'],
        priceRange: [149, 1499],
      },
    },
  },
  "baby-care": {
    weightRangeKg: [0.1, 2],
    subcategories: {
      "baby-care-diapers-and-wipes": {
        names: ['Baby Diaper Pants Pack', 'Baby Wet Wipes Pack', 'Overnight Diaper Pack', 'Newborn Diaper Pack', 'Sensitive Skin Baby Wipes'],
        priceRange: [299, 1299],
      },
      "baby-care-baby-feeding": {
        names: ['Baby Feeding Bottle Set', 'Silicone Baby Bib', 'Baby Food Steamer & Blender', 'Sipper Cup for Toddlers', 'Manual Breast Pump'],
        priceRange: [199, 1999],
      },
      "baby-care-baby-bath-and-skincare": {
        names: ['Baby Shampoo & Body Wash', 'Baby Lotion', 'Foldable Baby Bath Tub', 'Baby Massage Oil', 'Baby Diaper Rash Cream'],
        priceRange: [149, 999],
      },
      "baby-care-baby-gear": {
        names: ['Baby Stroller', 'Baby Car Seat', 'Baby Carrier', 'Baby Play Mat', 'Baby Bouncer'],
        priceRange: [1999, 9999],
      },
      "baby-care-baby-toys": {
        names: ['Soft Plush Baby Toy', 'Baby Rattle Set', 'Musical Baby Mobile', 'Teething Toy Set', 'Baby Activity Gym'],
        priceRange: [199, 1499],
      },
    },
  },
  "musical-instruments": {
    weightRangeKg: [0.5, 8],
    subcategories: {
      "musical-instruments-guitars": {
        names: ['Acoustic Guitar for Beginners', 'Electric Guitar with Amp', 'Classical Nylon String Guitar', 'Semi-Acoustic Guitar', 'Travel Size Acoustic Guitar'],
        priceRange: [3999, 24999],
      },
      "musical-instruments-keyboards-and-pianos": {
        names: ['61-Key Electronic Keyboard', 'Digital Piano with Stand', 'Portable Mini Keyboard', 'MIDI Keyboard Controller', 'Beginner Piano Keyboard'],
        priceRange: [4999, 34999],
      },
      "musical-instruments-drums-and-percussion": {
        names: ['5-Piece Drum Kit', 'Electronic Drum Pad Set', 'Djembe Hand Drum', 'Cajon Percussion Box', 'Practice Drum Pad'],
        priceRange: [2999, 19999],
      },
      "musical-instruments-wind-instruments": {
        names: ['Beginner Flute', 'Student Trumpet', 'Alto Saxophone', 'Harmonica Set', 'Clarinet for Beginners'],
        priceRange: [2999, 14999],
      },
      "musical-instruments-studio-equipment": {
        names: ['USB Condenser Microphone', 'Audio Interface', 'Studio Headphones', 'Microphone Stand', 'Sound Mixer Console'],
        priceRange: [1999, 12999],
      },
    },
  },
  "gifts-and-occasions": {
    weightRangeKg: [0.05, 1],
    subcategories: {
      "gifts-and-occasions-gift-cards": {
        names: ['Peshani Gift Card Rs.500', 'Peshani Gift Card Rs.1000', 'Peshani Gift Card Rs.2000', 'Peshani Gift Card Rs.5000', 'Peshani Festive Gift Card'],
        priceRange: [500, 5000],
        fixedPrices: [500, 1000, 2000, 5000, 1500],
      },
      "gifts-and-occasions-party-supplies": {
        names: ['Birthday Party Decoration Kit', 'Balloon Bouquet Set', 'Party Confetti Poppers', 'Themed Party Tableware Set', 'Party Photo Booth Props'],
        priceRange: [199, 1499],
      },
      "gifts-and-occasions-festive-decor": {
        names: ['LED Diya Set', 'Festive Wall Hanging Toran', 'Christmas Tree Decoration Set', 'Festive Fairy String Lights', 'Rangoli Stencil Set'],
        priceRange: [149, 1999],
      },
      "gifts-and-occasions-personalized-gifts": {
        names: ['Customized Photo Mug', 'Personalized Name Keychain', 'Custom Engraved Photo Frame', 'Personalized Cushion Cover', 'Custom Printed T-Shirt'],
        priceRange: [299, 1999],
      },
      "gifts-and-occasions-greeting-cards": {
        names: ['Birthday Greeting Card Pack', 'Anniversary Greeting Card', 'Thank You Card Set', 'Handmade Festive Greeting Card', 'Congratulations Greeting Card'],
        priceRange: [49, 299],
      },
    },
  },
};

const VIEW_LABELS = ['Main View', 'Side View', 'Detail View', 'Lifestyle View'];
const CATEGORY_COLORS: Record<string, { bg: string; accent: string }> = {
  "men-s-fashion": { bg: '#1f2937', accent: '#60a5fa' },
  "women-s-fashion": { bg: '#831843', accent: '#f9a8d4' },
  "kids-fashion": { bg: '#78350f', accent: '#fbbf24' },
  "home-and-kitchen": { bg: '#134e4a', accent: '#5eead4' },
  "electronics": { bg: '#111827', accent: '#818cf8' },
  "mobile-accessories": { bg: '#312e81', accent: '#a5b4fc' },
  "beauty-and-health": { bg: '#831843', accent: '#fda4af' },
  "automotive": { bg: '#292524', accent: '#fb923c' },
  "sports-and-fitness": { bg: '#14532d', accent: '#86efac' },
  "books-and-stationery": { bg: '#451a03', accent: '#fcd34d' },
  "groceries": { bg: '#365314', accent: '#bef264' },
  "furniture": { bg: '#3f2d1c', accent: '#d6b98c' },
  "jewellery": { bg: '#3f1d1d', accent: '#fbbf24' },
  "footwear": { bg: '#1c1917', accent: '#f87171' },
  "bags-and-luggage": { bg: '#422006', accent: '#fdba74' },
  "toys-and-games": { bg: '#701a75', accent: '#f0abfc' },
  "pet-supplies": { bg: '#164e63', accent: '#67e8f9' },
  "baby-care": { bg: '#155e75', accent: '#a5f3fc' },
  "musical-instruments": { bg: '#1e1b4b', accent: '#c4b5fd' },
  "gifts-and-occasions": { bg: '#7f1d1d', accent: '#fca5a5' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function codeFromName(name: string, len = 3): string {
  const clean = name.replace(/[^a-zA-Z\s]/g, '');
  const firstWord = clean.trim().split(/\s+/)[0] ?? 'GEN';
  return firstWord.toUpperCase().slice(0, len).padEnd(len, 'X');
}

// A handful of sibling subcategories share a leading word ("Car Accessories"
// vs "Car Care"; "Pet Toys" vs "Pet Grooming" vs "Pet Accessories"; four
// different "Baby ..." subcategories) which would otherwise collide onto the
// same first-word-derived SKU prefix as a sibling and get silently
// (mis-)treated as "already seeded". Override just those, by slug, so their
// SKUs stay unique; every other subcategory keeps deriving from its name.
const SUBCATEGORY_CODE_OVERRIDES: Record<string, string> = {
  'automotive-car-care': 'CRC',
  'pet-supplies-pet-grooming': 'PGR',
  'pet-supplies-pet-accessories': 'PAC',
  'baby-care-baby-bath-and-skincare': 'BBS',
  'baby-care-baby-gear': 'BGR',
  'baby-care-baby-toys': 'BTY',
};

function subCategoryCode(slug: string, name: string): string {
  return SUBCATEGORY_CODE_OVERRIDES[slug] ?? codeFromName(name);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Greedy word-wrap into at most 3 lines of roughly `maxCharsPerLine` chars. */
function wrapText(text: string, maxCharsPerLine = 18, maxLines = 3): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

async function generateProductImage(productName: string, viewLabel: string, colors: { bg: string; accent: string }): Promise<Buffer> {
  const size = 900;
  const lines = wrapText(productName);
  const startY = size / 2 - ((lines.length - 1) * 27);
  const textSvg = lines
    .map((line, i) => `<text x="${size / 2}" y="${startY + i * 54}" font-size="40" font-family="Arial, sans-serif" fill="#ffffff" text-anchor="middle" font-weight="700">${escapeXml(line)}</text>`)
    .join('\n');

  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="${colors.bg}"/>
    <circle cx="${size / 2}" cy="${size / 2 - 20}" r="230" fill="${colors.accent}" opacity="0.22"/>
    ${textSvg}
    <rect x="0" y="${size - 90}" width="${size}" height="90" fill="rgba(0,0,0,0.4)"/>
    <text x="${size / 2}" y="${size - 38}" font-size="28" font-family="Arial, sans-serif" fill="#ffffff" text-anchor="middle">${escapeXml(viewLabel)}</text>
    <text x="${size / 2}" y="${size - 12}" font-size="16" font-family="Arial, sans-serif" fill="#d1d5db" text-anchor="middle">Peshani Demo Catalog</text>
  </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

function buildShortDescription(name: string, subcategoryName: string): string {
  return `${name} - a versatile pick from our ${subcategoryName} collection, chosen for everyday quality and value.`;
}

function buildDescription(name: string, subcategoryName: string, categoryName: string): string {
  return (
    `${name} is part of Peshani's ${categoryName} range, curated for quality and everyday reliability. ` +
    `This ${subcategoryName.toLowerCase()} pick combines thoughtful design with dependable performance, making it a great addition to your collection. ` +
    `Explore more from our ${categoryName} catalog for coordinated style and function.`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface RunStats {
  productsCreated: number;
  productsSkippedExisting: number;
  imagesUploaded: number;
  inventoryInitialized: number;
  errors: { sku: string; message: string }[];
}

async function main() {
  const stats: RunStats = { productsCreated: 0, productsSkippedExisting: 0, imagesUploaded: 0, inventoryInitialized: 0, errors: [] };

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const prisma = app.get(PrismaService);
    const productsService = app.get(ProductsService);
    const productImagesService = app.get(ProductImagesService);
    const inventoryService = app.get(InventoryService);

    const store = await prisma.store.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!store) throw new Error('No store found');
    const storeId = store.id;

    const adminUser = await prisma.user.findFirst({ where: { storeId, type: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
    if (!adminUser) throw new Error('No ADMIN user found in this store to attribute the seed operation to');

    const actor: AuthenticatedUser = {
      userId: adminUser.id,
      storeId,
      email: adminUser.email,
      type: 'ADMIN',
      roles: ['SUPER_ADMIN'],
      permissions: [],
    };

    const warehouse = await prisma.warehouse.upsert({
      where: { storeId_code: { storeId, code: 'MAIN' } },
      update: {},
      create: { storeId, name: 'Main Warehouse', code: 'MAIN', isDefault: true, isActive: true },
    });

    const categories = await prisma.category.findMany({
      where: { storeId, deletedAt: null, parentId: null },
      orderBy: { sortOrder: 'asc' },
      include: { children: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });

    console.log(`Found ${categories.length} top-level categories, ${categories.reduce((n, c) => n + c.children.length, 0)} subcategories.`);

    let globalProductIndex = 0;

    for (const category of categories) {
      const categorySpec = CATALOG[category.slug];
      if (!categorySpec) {
        console.warn(`No catalog spec for category "${category.name}" (${category.slug}) - skipping its subcategories.`);
        continue;
      }
      const colors = CATEGORY_COLORS[category.slug] ?? { bg: '#1f2937', accent: '#60a5fa' };
      const catCode = codeFromName(category.name);

      for (const subcategory of category.children) {
        const subSpec = categorySpec.subcategories[subcategory.slug];
        if (!subSpec) {
          console.warn(`No catalog spec for subcategory "${subcategory.name}" (${subcategory.slug}) - skipping.`);
          continue;
        }
        const subCode = subCategoryCode(subcategory.slug, subcategory.name);

        for (let i = 0; i < 5; i++) {
          const name = subSpec.names[i];
          const sku = `${catCode}-${subCode}-${String(i + 1).padStart(3, '0')}`;

          const existing = await prisma.product.findFirst({ where: { storeId, sku } });
          if (existing) {
            stats.productsSkippedExisting += 1;
            globalProductIndex += 1;
            continue;
          }

          try {
            const price = subSpec.fixedPrices ? subSpec.fixedPrices[i] : randomInt(subSpec.priceRange[0], subSpec.priceRange[1]);
            const hasCompareAt = !subSpec.fixedPrices && Math.random() < 0.3;
            const compareAtPrice = hasCompareAt ? Math.round(price * (1.15 + Math.random() * 0.25)) : undefined;
            const weight = (Math.random() * (categorySpec.weightRangeKg[1] - categorySpec.weightRangeKg[0]) + categorySpec.weightRangeKg[0]).toFixed(3);

            const product = await productsService.create(
              storeId,
              {
                name,
                sku,
                shortDescription: buildShortDescription(name, subcategory.name),
                description: buildDescription(name, subcategory.name, category.name),
                basePrice: price.toFixed(2),
                compareAtPrice: compareAtPrice?.toFixed(2),
                weight,
                status: 'ACTIVE',
                categoryIds: [category.id, subcategory.id],
                tagNames: [category.name, subcategory.name].slice(0, 30),
                seoTitle: name,
                seoDescription: buildShortDescription(name, subcategory.name),
              },
              actor,
            );
            stats.productsCreated += 1;

            const imageCount = [2, 3, 4][globalProductIndex % 3];
            for (let v = 0; v < imageCount; v++) {
              const buffer = await generateProductImage(name, VIEW_LABELS[v], colors);
              const file = {
                buffer,
                mimetype: 'image/jpeg',
                size: buffer.length,
                originalname: `${product.slug}-${v + 1}.jpg`,
              } as Express.Multer.File;
              await productImagesService.upload(storeId, product.id, file, { altText: `${name} - ${VIEW_LABELS[v]}` }, actor);
              stats.imagesUploaded += 1;
            }

            await inventoryService.initialize(
              storeId,
              { warehouseId: warehouse.id, productId: product.id, quantity: randomInt(25, 100), lowStockThreshold: 10 },
              actor,
            );
            stats.inventoryInitialized += 1;
          } catch (error) {
            stats.errors.push({ sku, message: error instanceof Error ? error.message : String(error) });
            console.error(`FAILED: ${sku} (${name}):`, error instanceof Error ? error.message : error);
          }

          globalProductIndex += 1;
          if (globalProductIndex % 25 === 0) {
            console.log(`Progress: ${globalProductIndex} / 500 products processed (${stats.productsCreated} created, ${stats.errors.length} errors)`);
          }
        }
      }
    }

    console.log('\n==================== SEED RUN SUMMARY ====================');
    console.log(JSON.stringify(stats, null, 2));
    console.log('============================================================');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Fatal error running seed-catalog:', err);
  process.exitCode = 1;
});
