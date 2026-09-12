/**
 * DEMO CATALOG SEED v2 - not production data.
 *
 * Replaces the previous demo catalog (20 categories / 100 subcategories / 500
 * products created by seed-catalog.ts + reset-categories.ts) with a new,
 * more realistic taxonomy and product set. Only removes records this script
 * itself is responsible for (identified by exact category slug and by the
 * old deterministic SKU pattern) - verified beforehand to have zero order/
 * review/wishlist/cart/promotion references, so the removal is a safe hard
 * delete, not a soft-archive. Unrelated categories/products left behind by
 * other test suites in this same shared dev database are never touched.
 *
 * Everything is created through the real NestJS services (ProductsService,
 * ProductVariantsService, ProductImagesService, InventoryService), not raw
 * SQL, so every existing business rule/validation/audit-log path applies
 * exactly as it would to an admin using the UI.
 *
 * Idempotent: re-running skips any product whose SKU already exists.
 *
 * Run with: npx ts-node prisma/seed-catalog-v2.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProductsService } from '../src/modules/products/products.service';
import { ProductVariantsService } from '../src/modules/product-variants/product-variants.service';
import { ProductImagesService } from '../src/modules/product-images/product-images.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { AuthenticatedUser } from '../src/modules/auth/types/authenticated-user.type';

// ---------------------------------------------------------------------------
// OLD catalog identifiers (for cleanup only)
// ---------------------------------------------------------------------------

const OLD_CATEGORY_SLUGS = [
  'men-s-fashion', 'women-s-fashion', 'kids-fashion', 'home-and-kitchen', 'electronics',
  'mobile-accessories', 'beauty-and-health', 'automotive', 'sports-and-fitness', 'books-and-stationery',
  'groceries', 'furniture', 'jewellery', 'footwear', 'bags-and-luggage', 'toys-and-games',
  'pet-supplies', 'baby-care', 'musical-instruments', 'gifts-and-occasions',
];
const OLD_SKU_PATTERN = /^[A-Z]{3}-[A-Z]{3,4}-\d{3}$/;

// ---------------------------------------------------------------------------
// NEW taxonomy
// ---------------------------------------------------------------------------

type Product = { name: string; brand: string };
interface Subcategory {
  slug: string;
  name: string;
  code: string;
  priceRange: [number, number];
  isVariable?: boolean;
  variantAxis?: 'size' | 'shoeSize';
  products: [Product, Product, Product, Product, Product];
}
interface Category {
  slug: string;
  name: string;
  code: string;
  weightRangeKg: [number, number];
  featureBlurb: string;
  subcategories: Subcategory[];
}

const CATEGORIES: Category[] = [
  {
    slug: 'electronics', name: 'Electronics', code: 'ELEC', weightRangeKg: [0.1, 1],
    featureBlurb: 'a capable, everyday device built for reliable performance',
    subcategories: [
      { slug: 'smartphones', name: 'Smartphones', code: 'PHN', priceRange: [9999, 89999], products: [
        { name: 'Samsung Galaxy A56 5G', brand: 'Samsung' }, { name: 'OnePlus Nord 5', brand: 'OnePlus' },
        { name: 'Google Pixel 9a', brand: 'Google' }, { name: 'Motorola Edge 60 Fusion', brand: 'Motorola' },
        { name: 'Nothing Phone (3a)', brand: 'Nothing' },
      ] },
      { slug: 'laptops', name: 'Laptops', code: 'LAP', priceRange: [32999, 149999], products: [
        { name: 'Lenovo IdeaPad Slim 5', brand: 'Lenovo' }, { name: 'HP Pavilion 14', brand: 'HP' },
        { name: 'Dell Inspiron 14', brand: 'Dell' }, { name: 'ASUS Vivobook 15', brand: 'ASUS' },
        { name: 'Acer Aspire 5', brand: 'Acer' },
      ] },
      { slug: 'tablets', name: 'Tablets', code: 'TAB', priceRange: [12999, 69999], products: [
        { name: 'Samsung Galaxy Tab A10', brand: 'Samsung' }, { name: 'Lenovo Tab M11', brand: 'Lenovo' },
        { name: 'Xiaomi Redmi Pad SE', brand: 'Xiaomi' }, { name: 'Realme Pad 2', brand: 'Realme' },
        { name: 'OnePlus Pad Go', brand: 'OnePlus' },
      ] },
      { slug: 'headphones-and-earbuds', name: 'Headphones & Earbuds', code: 'HDP', priceRange: [999, 24999], products: [
        { name: 'Sony WH-CH520 Wireless Headphones', brand: 'Sony' }, { name: 'boAt Airdopes 141 TWS Earbuds', brand: 'boAt' },
        { name: 'JBL Tune 510BT Headphones', brand: 'JBL' }, { name: 'Samsung Galaxy Buds FE', brand: 'Samsung' },
        { name: 'Noise Buds VS104 Earbuds', brand: 'Noise' },
      ] },
      { slug: 'smartwatches', name: 'Smartwatches', code: 'WCH', priceRange: [1999, 34999], products: [
        { name: 'Noise ColorFit Pulse 3 Smartwatch', brand: 'Noise' }, { name: 'boAt Wave Neo Smartwatch', brand: 'boAt' },
        { name: 'Samsung Galaxy Watch7', brand: 'Samsung' }, { name: 'Fire-Boltt Phoenix Pro Smartwatch', brand: 'Fire-Boltt' },
        { name: 'Amazfit Bip 5 Smartwatch', brand: 'Amazfit' },
      ] },
    ],
  },
  {
    slug: 'computers-and-accessories', name: 'Computers & Accessories', code: 'COMP', weightRangeKg: [0.1, 6],
    featureBlurb: 'a dependable computing accessory built for daily productivity',
    subcategories: [
      { slug: 'monitors', name: 'Monitors', code: 'MON', priceRange: [7999, 44999], products: [
        { name: 'Dell 24-inch Full HD Monitor', brand: 'Dell' }, { name: 'LG 27-inch IPS Monitor', brand: 'LG' },
        { name: 'Samsung 24-inch Curved Monitor', brand: 'Samsung' }, { name: 'ASUS 27-inch 144Hz Gaming Monitor', brand: 'ASUS' },
        { name: 'Acer 22-inch Full HD Monitor', brand: 'Acer' },
      ] },
      { slug: 'keyboards', name: 'Keyboards', code: 'KEY', priceRange: [499, 8999], products: [
        { name: 'Logitech K120 Wired Keyboard', brand: 'Logitech' }, { name: 'HP Wireless Keyboard K3000', brand: 'HP' },
        { name: 'Dell KB216 Wired Keyboard', brand: 'Dell' }, { name: 'Redgear MK881 Mechanical Keyboard', brand: 'Redgear' },
        { name: 'Logitech MX Keys Wireless Keyboard', brand: 'Logitech' },
      ] },
      { slug: 'mice', name: 'Mice', code: 'MCE', priceRange: [299, 5999], products: [
        { name: 'Logitech B100 Wired Mouse', brand: 'Logitech' }, { name: 'HP Wireless Mouse 220', brand: 'HP' },
        { name: 'Dell Optical Wired Mouse', brand: 'Dell' }, { name: 'Redgear A-15 Gaming Mouse', brand: 'Redgear' },
        { name: 'Logitech M331 Silent Wireless Mouse', brand: 'Logitech' },
      ] },
      { slug: 'computer-accessories', name: 'Computer Accessories', code: 'ACC', priceRange: [299, 4999], products: [
        { name: 'Logitech C270 HD Webcam', brand: 'Logitech' }, { name: 'boAt Stone 350 Laptop Speaker', brand: 'boAt' },
        { name: 'Portronics USB Hub 4-Port', brand: 'Portronics' }, { name: 'HP Laptop Cooling Pad', brand: 'HP' },
        { name: 'Amkette Laptop Sleeve 15.6-inch', brand: 'Amkette' },
      ] },
      { slug: 'storage-devices', name: 'Storage Devices', code: 'STO', priceRange: [499, 12999], products: [
        { name: 'SanDisk 32GB USB Flash Drive', brand: 'SanDisk' }, { name: 'WD Elements 1TB Portable Hard Drive', brand: 'WD' },
        { name: 'Seagate Backup Plus 2TB Hard Drive', brand: 'Seagate' }, { name: 'Samsung 500GB Portable SSD T7', brand: 'Samsung' },
        { name: 'Kingston 128GB microSD Card', brand: 'Kingston' },
      ] },
    ],
  },
  {
    slug: 'tvs-and-home-entertainment', name: 'TVs & Home Entertainment', code: 'TVHE', weightRangeKg: [1, 20],
    featureBlurb: 'a home entertainment upgrade built for movie nights and everyday viewing',
    subcategories: [
      { slug: 'smart-tvs', name: 'Smart TVs', code: 'SMT', priceRange: [19999, 199999], products: [
        { name: 'Samsung Crystal UHD 55-inch 4K Smart TV', brand: 'Samsung' }, { name: 'LG UR75 50-inch 4K Smart TV', brand: 'LG' },
        { name: 'Sony Bravia 55-inch 4K Google TV', brand: 'Sony' }, { name: 'TCL C6K 55-inch QLED TV', brand: 'TCL' },
        { name: 'Hisense 50-inch 4K Smart TV', brand: 'Hisense' },
      ] },
      { slug: 'streaming-devices', name: 'Streaming Devices', code: 'STR', priceRange: [1999, 9999], products: [
        { name: 'Amazon Fire TV Stick 4K', brand: 'Amazon' }, { name: 'Google Chromecast with Google TV', brand: 'Google' },
        { name: 'Xiaomi Mi Box 4K', brand: 'Xiaomi' }, { name: 'Roku Streaming Stick 4K', brand: 'Roku' },
        { name: 'Amazon Fire TV Stick Lite', brand: 'Amazon' },
      ] },
      { slug: 'soundbars', name: 'Soundbars', code: 'SND', priceRange: [3999, 39999], products: [
        { name: 'JBL Bar 2.0 All-in-One Soundbar', brand: 'JBL' }, { name: 'Samsung HW-B450 2.1 Soundbar', brand: 'Samsung' },
        { name: 'boAt Aavante Bar 1500 Soundbar', brand: 'boAt' }, { name: 'Sony HT-S20R Soundbar', brand: 'Sony' },
        { name: 'LG SN4 2.1 Channel Soundbar', brand: 'LG' },
      ] },
      { slug: 'home-theater-systems', name: 'Home Theater Systems', code: 'HTS', priceRange: [8999, 59999], products: [
        { name: 'Philips 5.1 Home Theater System', brand: 'Philips' }, { name: 'Zebronics BT4460 5.1 Home Theater', brand: 'Zebronics' },
        { name: 'Sony 5.1ch Home Cinema System', brand: 'Sony' }, { name: 'JBL Cinema 5.1 Speaker System', brand: 'JBL' },
        { name: 'boAt Avante Bar 2200D Home Theater', brand: 'boAt' },
      ] },
      { slug: 'projectors', name: 'Projectors', code: 'PRJ', priceRange: [6999, 79999], products: [
        { name: 'BenQ TH585 Full HD Projector', brand: 'BenQ' }, { name: 'Epson EH-TW5825 Home Cinema Projector', brand: 'Epson' },
        { name: 'Xiaomi Mi Smart Projector 2', brand: 'Xiaomi' }, { name: 'ViewSonic PA503S Portable Projector', brand: 'ViewSonic' },
        { name: 'Egate i9 Pro-Max Mini Projector', brand: 'Egate' },
      ] },
    ],
  },
  {
    slug: 'home-appliances', name: 'Home Appliances', code: 'HAPP', weightRangeKg: [3, 70],
    featureBlurb: 'a household appliance built for dependable, energy-conscious everyday use',
    subcategories: [
      { slug: 'refrigerators', name: 'Refrigerators', code: 'REF', priceRange: [16999, 89999], products: [
        { name: 'Samsung 253L Frost Free Double Door Refrigerator', brand: 'Samsung' }, { name: 'LG 260L Frost Free Refrigerator', brand: 'LG' },
        { name: 'Whirlpool 200L Single Door Refrigerator', brand: 'Whirlpool' }, { name: 'Haier 195L Direct Cool Refrigerator', brand: 'Haier' },
        { name: 'Godrej 236L Frost Free Refrigerator', brand: 'Godrej' },
      ] },
      { slug: 'washing-machines', name: 'Washing Machines', code: 'WSH', priceRange: [11999, 59999], products: [
        { name: 'LG 7kg Front Load Washing Machine', brand: 'LG' }, { name: 'Samsung 6.5kg Fully Automatic Top Load Washing Machine', brand: 'Samsung' },
        { name: 'Whirlpool 7.5kg Semi-Automatic Washing Machine', brand: 'Whirlpool' }, { name: 'IFB 6kg Front Load Washing Machine', brand: 'IFB' },
        { name: 'Bosch 7kg Fully Automatic Front Load Washing Machine', brand: 'Bosch' },
      ] },
      { slug: 'air-conditioners', name: 'Air Conditioners', code: 'AC', priceRange: [26999, 69999], products: [
        { name: 'Voltas 1.5 Ton 3 Star Split AC', brand: 'Voltas' }, { name: 'LG 1.5 Ton 5 Star Inverter Split AC', brand: 'LG' },
        { name: 'Daikin 1 Ton 3 Star Inverter Split AC', brand: 'Daikin' }, { name: 'Samsung 1.5 Ton Windfree Inverter AC', brand: 'Samsung' },
        { name: 'Blue Star 1.5 Ton 3 Star Split AC', brand: 'Blue Star' },
      ] },
      { slug: 'microwave-ovens', name: 'Microwave Ovens', code: 'MWV', priceRange: [5999, 24999], products: [
        { name: 'IFB 20L Convection Microwave Oven', brand: 'IFB' }, { name: 'Samsung 23L Convection Microwave Oven', brand: 'Samsung' },
        { name: 'LG 28L Convection Microwave Oven', brand: 'LG' }, { name: 'Bajaj 17L Solo Microwave Oven', brand: 'Bajaj' },
        { name: 'Panasonic 20L Solo Microwave Oven', brand: 'Panasonic' },
      ] },
      { slug: 'vacuum-cleaners', name: 'Vacuum Cleaners', code: 'VAC', priceRange: [2999, 34999], products: [
        { name: 'Eureka Forbes Rapid Vacuum Cleaner', brand: 'Eureka Forbes' }, { name: 'Philips PowerPro Compact Vacuum Cleaner', brand: 'Philips' },
        { name: 'Xiaomi Mi Robot Vacuum-Mop', brand: 'Xiaomi' }, { name: 'Havells RE01 Vacuum Cleaner', brand: 'Havells' },
        { name: 'Kent Wet & Dry Vacuum Cleaner', brand: 'Kent' },
      ] },
    ],
  },
  {
    slug: 'kitchen-appliances', name: 'Kitchen Appliances', code: 'KAPP', weightRangeKg: [0.5, 8],
    featureBlurb: 'a compact kitchen appliance designed to make everyday cooking faster and easier',
    subcategories: [
      { slug: 'mixer-grinders', name: 'Mixer Grinders', code: 'MIX', priceRange: [1999, 8999], products: [
        { name: 'Preethi Blue Leaf Mixer Grinder', brand: 'Preethi' }, { name: 'Bajaj Rex 750W Mixer Grinder', brand: 'Bajaj' },
        { name: 'Prestige Iris 750W Mixer Grinder', brand: 'Prestige' }, { name: 'Philips HL7756 Mixer Grinder', brand: 'Philips' },
        { name: 'Butterfly Matchless Mixer Grinder', brand: 'Butterfly' },
      ] },
      { slug: 'air-fryers', name: 'Air Fryers', code: 'FRY', priceRange: [3499, 12999], products: [
        { name: 'Philips Essential Air Fryer', brand: 'Philips' }, { name: 'INALSA Air Fryer Fry-Light', brand: 'INALSA' },
        { name: 'Prestige PAF 6.0 Air Fryer', brand: 'Prestige' }, { name: 'Havells Prolife Digi Air Fryer', brand: 'Havells' },
        { name: 'AGARO Marvel Air Fryer', brand: 'AGARO' },
      ] },
      { slug: 'electric-kettles', name: 'Electric Kettles', code: 'KET', priceRange: [599, 2999], products: [
        { name: 'Prestige PKOSS 1.5L Electric Kettle', brand: 'Prestige' }, { name: 'Bajaj Majesty 1.8L Electric Kettle', brand: 'Bajaj' },
        { name: 'Philips HD9350 Electric Kettle', brand: 'Philips' }, { name: 'Havells Cristal 1.2L Electric Kettle', brand: 'Havells' },
        { name: 'Butterfly EKN 1.5L Electric Kettle', brand: 'Butterfly' },
      ] },
      { slug: 'coffee-machines', name: 'Coffee Machines', code: 'COF', priceRange: [2499, 24999], products: [
        { name: 'Philips Daily Collection Coffee Maker', brand: 'Philips' }, { name: 'Morphy Richards Fresco Coffee Maker', brand: 'Morphy Richards' },
        { name: 'Nescafe Dolce Gusto Coffee Machine', brand: 'Nescafe' }, { name: 'Cello Café Espresso Coffee Maker', brand: 'Cello' },
        { name: 'AGARO Regal Espresso Coffee Machine', brand: 'AGARO' },
      ] },
      { slug: 'toasters', name: 'Toasters', code: 'TST', priceRange: [999, 3999], products: [
        { name: 'Bajaj Majesty 2-Slice Pop-up Toaster', brand: 'Bajaj' }, { name: 'Philips Daily Collection Toaster', brand: 'Philips' },
        { name: 'Prestige PPTPKB 2-Slice Toaster', brand: 'Prestige' }, { name: 'Havells Vio 2-Slice Toaster', brand: 'Havells' },
        { name: 'Morphy Richards 2-Slice Toaster', brand: 'Morphy Richards' },
      ] },
    ],
  },
  {
    slug: 'mobiles-and-mobile-accessories', name: 'Mobiles & Mobile Accessories', code: 'MOBA', weightRangeKg: [0.02, 0.4],
    featureBlurb: 'a practical mobile accessory built for everyday phone use',
    subcategories: [
      { slug: 'mobile-chargers', name: 'Mobile Chargers', code: 'CHG', priceRange: [199, 1999], products: [
        { name: 'Samsung 25W Fast Charger', brand: 'Samsung' }, { name: 'boAt Type-C 33W Charger', brand: 'boAt' },
        { name: 'Portronics Adapto 20W Charger', brand: 'Portronics' }, { name: 'Realme 33W SUPERDART Charger', brand: 'Realme' },
        { name: 'Ambrane 20W PD Fast Charger', brand: 'Ambrane' },
      ] },
      { slug: 'power-banks', name: 'Power Banks', code: 'PWR', priceRange: [699, 3499], products: [
        { name: 'Mi 20000mAh Power Bank', brand: 'Mi' }, { name: 'boAt 10000mAh Power Bank', brand: 'boAt' },
        { name: 'Ambrane 20000mAh Fast Charging Power Bank', brand: 'Ambrane' }, { name: 'Portronics Volt C25 Power Bank', brand: 'Portronics' },
        { name: 'Realme 10000mAh Power Bank', brand: 'Realme' },
      ] },
      { slug: 'mobile-cases', name: 'Mobile Cases', code: 'CAS', priceRange: [149, 999], products: [
        { name: 'Spigen Rugged Armor Phone Case', brand: 'Spigen' }, { name: 'Nillkin Frosted Shield Phone Case', brand: 'Nillkin' },
        { name: 'Samsung Silicone Cover', brand: 'Samsung' }, { name: 'boAt Defender Series Phone Case', brand: 'boAt' },
        { name: 'Bella Cover Transparent Phone Case', brand: 'Bella Cover' },
      ] },
      { slug: 'screen-protectors', name: 'Screen Protectors', code: 'SCR', priceRange: [99, 599], products: [
        { name: 'Spigen Tempered Glass Screen Protector', brand: 'Spigen' }, { name: 'Nillkin Privacy Screen Guard', brand: 'Nillkin' },
        { name: 'Samsung Official Screen Protector', brand: 'Samsung' }, { name: 'MOFI Anti-Glare Screen Guard', brand: 'MOFI' },
        { name: 'Bella Cover Edge-to-Edge Screen Protector', brand: 'Bella Cover' },
      ] },
      { slug: 'mobile-stands-and-holders', name: 'Mobile Stands & Holders', code: 'STD', priceRange: [149, 1499], products: [
        { name: 'Portronics Adjustable Mobile Stand', brand: 'Portronics' }, { name: 'AmazonBasics Phone Stand', brand: 'AmazonBasics' },
        { name: 'boAt Car Mobile Mount Holder', brand: 'boAt' }, { name: 'Ubon Foldable Phone Stand', brand: 'Ubon' },
        { name: 'Zebronics Desktop Mobile Stand', brand: 'Zebronics' },
      ] },
    ],
  },
  {
    slug: 'fashion-men', name: 'Fashion — Men', code: 'FMEN', weightRangeKg: [0.15, 0.7],
    featureBlurb: "a wardrobe essential from Peshani's men's fashion collection",
    subcategories: [
      { slug: 't-shirts', name: 'T-Shirts', code: 'TSH', priceRange: [499, 1999], isVariable: true, variantAxis: 'size', products: [
        { name: "Men's Essential Cotton Crew Neck T-Shirt", brand: 'Roadster' }, { name: "Men's Premium Slim Fit T-Shirt", brand: 'Van Heusen' },
        { name: "Men's Performance Polo T-Shirt", brand: 'Puma' }, { name: "Men's Graphic Cotton T-Shirt", brand: 'Roadster' },
        { name: "Men's Relaxed Fit Henley T-Shirt", brand: 'Allen Solly' },
      ] },
      { slug: 'shirts', name: 'Shirts', code: 'SHT', priceRange: [799, 2999], isVariable: true, variantAxis: 'size', products: [
        { name: "Men's Slim Fit Oxford Shirt", brand: 'Van Heusen' }, { name: "Men's Checked Casual Shirt", brand: 'Allen Solly' },
        { name: "Men's Formal Cotton Shirt", brand: 'Peter England' }, { name: "Men's Linen Casual Shirt", brand: 'Roadster' },
        { name: "Men's Denim Casual Shirt", brand: 'Levi’s' },
      ] },
      { slug: 'jeans', name: 'Jeans', code: 'JNS', priceRange: [999, 3999], isVariable: true, variantAxis: 'size', products: [
        { name: "Men's Slim Fit Stretch Jeans", brand: 'Levi’s' }, { name: "Men's Straight Fit Jeans", brand: 'Roadster' },
        { name: "Men's Distressed Skinny Jeans", brand: 'Spykar' }, { name: "Men's Relaxed Fit Denim Jeans", brand: 'Wrangler' },
        { name: "Men's Dark Wash Bootcut Jeans", brand: 'Lee' },
      ] },
      { slug: 'trousers', name: 'Trousers', code: 'TRS', priceRange: [899, 2999], products: [
        { name: "Men's Slim Fit Chino Trousers", brand: 'Van Heusen' }, { name: "Men's Formal Regular Fit Trousers", brand: 'Peter England' },
        { name: "Men's Cotton Cargo Trousers", brand: 'Roadster' }, { name: "Men's Tapered Fit Trousers", brand: 'Allen Solly' },
        { name: "Men's Pleated Formal Trousers", brand: 'Arrow' },
      ] },
      { slug: 'jackets', name: 'Jackets', code: 'JKT', priceRange: [1499, 4999], products: [
        { name: "Men's Quilted Bomber Jacket", brand: 'Roadster' }, { name: "Men's Classic Denim Jacket", brand: 'Levi’s' },
        { name: "Men's Waterproof Windcheater Jacket", brand: 'Puma' }, { name: "Men's Faux Leather Biker Jacket", brand: 'Roadster' },
        { name: "Men's Hooded Puffer Jacket", brand: 'Adidas' },
      ] },
    ],
  },
  {
    slug: 'fashion-women', name: 'Fashion — Women', code: 'FWOM', weightRangeKg: [0.15, 0.7],
    featureBlurb: "a wardrobe essential from Peshani's women's fashion collection",
    subcategories: [
      { slug: 'kurtis', name: 'Kurtis', code: 'KUR', priceRange: [499, 2499], isVariable: true, variantAxis: 'size', products: [
        { name: "Women's Anarkali Kurti", brand: 'Biba' }, { name: "Women's Cotton Straight Kurti", brand: 'W' },
        { name: "Women's Printed A-Line Kurti", brand: 'Global Desi' }, { name: "Women's Chikankari Embroidered Kurti", brand: 'Biba' },
        { name: "Women's Rayon Flared Kurti", brand: 'W' },
      ] },
      { slug: 'sarees', name: 'Sarees', code: 'SAR', priceRange: [999, 6999], products: [
        { name: 'Banarasi Silk Saree', brand: 'Fabindia' }, { name: 'Printed Georgette Saree', brand: 'Biba' },
        { name: 'Chiffon Party Wear Saree', brand: 'Global Desi' }, { name: 'Cotton Handloom Saree', brand: 'Fabindia' },
        { name: 'Embellished Net Saree', brand: 'Biba' },
      ] },
      { slug: 'dresses', name: 'Dresses', code: 'DRS', priceRange: [799, 3499], isVariable: true, variantAxis: 'size', products: [
        { name: "Women's Floral Wrap Dress", brand: 'Vero Moda' }, { name: "Women's A-Line Midi Dress", brand: 'ONLY' },
        { name: "Women's Bodycon Party Dress", brand: 'Forever 21' }, { name: "Women's Off-Shoulder Maxi Dress", brand: 'Vero Moda' },
        { name: "Women's Casual Shirt Dress", brand: 'ONLY' },
      ] },
      { slug: 'tops', name: 'Tops', code: 'TOP', priceRange: [499, 1999], isVariable: true, variantAxis: 'size', products: [
        { name: "Women's Printed Cotton Top", brand: 'ONLY' }, { name: "Women's Ruffle Sleeve Top", brand: 'Vero Moda' },
        { name: "Women's Crop Top with Tie-Up", brand: 'Forever 21' }, { name: "Women's Embroidered Top", brand: 'Global Desi' },
        { name: "Women's Flowy Georgette Top", brand: 'W' },
      ] },
      { slug: 'womens-jeans', name: "Women's Jeans", code: 'WJN', priceRange: [999, 3499], isVariable: true, variantAxis: 'size', products: [
        { name: "Women's Skinny Fit Jeans", brand: 'Levi’s' }, { name: "Women's High-Waist Straight Jeans", brand: 'ONLY' },
        { name: "Women's Distressed Boyfriend Jeans", brand: 'Vero Moda' }, { name: "Women's Bootcut Jeans", brand: 'Lee' },
        { name: "Women's Jeggings", brand: 'Roadster' },
      ] },
    ],
  },
  {
    slug: 'footwear', name: 'Footwear', code: 'FOOT', weightRangeKg: [0.3, 1.2],
    featureBlurb: 'a comfortable, durable pair built for everyday wear',
    subcategories: [
      { slug: 'mens-casual-shoes', name: "Men's Casual Shoes", code: 'MCS', priceRange: [999, 4999], isVariable: true, variantAxis: 'shoeSize', products: [
        { name: "Men's Canvas Slip-On Shoes", brand: 'Bata' }, { name: "Men's Casual Lace-Up Sneakers", brand: 'Puma' },
        { name: "Men's Suede Casual Shoes", brand: 'Woodland' }, { name: "Men's Loafer Style Casual Shoes", brand: 'Red Tape' },
        { name: "Men's Everyday Walking Shoes", brand: 'Bata' },
      ] },
      { slug: 'mens-sports-shoes', name: "Men's Sports Shoes", code: 'MSS', priceRange: [1499, 7999], isVariable: true, variantAxis: 'shoeSize', products: [
        { name: "Men's Running Sports Shoes", brand: 'Nike' }, { name: "Men's Training Gym Shoes", brand: 'Adidas' },
        { name: "Men's Basketball Sports Shoes", brand: 'Puma' }, { name: "Men's Lightweight Walking Shoes", brand: 'Skechers' },
        { name: "Men's Trail Running Shoes", brand: 'Adidas' },
      ] },
      { slug: 'womens-casual-shoes', name: "Women's Casual Shoes", code: 'WCS', priceRange: [899, 4499], isVariable: true, variantAxis: 'shoeSize', products: [
        { name: "Women's Canvas Slip-On Shoes", brand: 'Bata' }, { name: "Women's Casual Sneakers", brand: 'Puma' },
        { name: "Women's Ballerina Flats", brand: 'Bata' }, { name: "Women's Loafers", brand: 'Red Tape' },
        { name: "Women's Everyday Walking Shoes", brand: 'Skechers' },
      ] },
      { slug: 'womens-sandals', name: "Women's Sandals", code: 'WSD', priceRange: [499, 2999], isVariable: true, variantAxis: 'shoeSize', products: [
        { name: "Women's Comfort Flat Sandals", brand: 'Bata' }, { name: "Women's Wedge Heel Sandals", brand: 'Catwalk' },
        { name: "Women's Sports Sandals", brand: 'Skechers' }, { name: "Women's Casual Slide Sandals", brand: 'Bata' },
        { name: "Women's Leather Strap Sandals", brand: 'Catwalk' },
      ] },
      { slug: 'kids-footwear', name: "Kids' Footwear", code: 'KDF', priceRange: [399, 2499], isVariable: true, variantAxis: 'shoeSize', products: [
        { name: "Kids' Casual Sneakers", brand: 'Bata' }, { name: "Kids' Velcro School Shoes", brand: 'Bata' },
        { name: "Kids' Sandals", brand: 'Liberty' }, { name: "Kids' Light-Up Sports Shoes", brand: 'Puma' },
        { name: "Kids' Flip Flops", brand: 'Liberty' },
      ] },
    ],
  },
  {
    slug: 'beauty-and-personal-care', name: 'Beauty & Personal Care', code: 'BEAU', weightRangeKg: [0.05, 0.6],
    featureBlurb: 'a gentle, everyday personal care product suited to regular use',
    subcategories: [
      { slug: 'face-care', name: 'Face Care', code: 'FCE', priceRange: [149, 1499], products: [
        { name: 'Vitamin C Face Serum', brand: 'Minimalist' }, { name: 'Hydrating Face Moisturizer', brand: 'Nivea' },
        { name: 'Charcoal Face Wash', brand: 'Himalaya' }, { name: 'Aloe Vera Soothing Gel', brand: 'Patanjali' },
        { name: 'Sunscreen SPF 50 Lotion', brand: 'Lakme' },
      ] },
      { slug: 'hair-care', name: 'Hair Care', code: 'HAR', priceRange: [149, 1299], products: [
        { name: 'Anti-Dandruff Shampoo', brand: 'Head & Shoulders' }, { name: 'Argan Oil Hair Conditioner', brand: 'Tresemme' },
        { name: 'Hair Growth Serum', brand: 'Mamaearth' }, { name: 'Keratin Hair Mask', brand: 'Loreal' },
        { name: 'Herbal Hair Oil', brand: 'Parachute' },
      ] },
      { slug: 'bath-and-body', name: 'Bath & Body', code: 'BAT', priceRange: [99, 999], products: [
        { name: 'Body Wash Shower Gel', brand: 'Dove' }, { name: 'Moisturizing Body Lotion', brand: 'Nivea' },
        { name: 'Handmade Bathing Bar Soap', brand: 'Fabindia' }, { name: 'Talc-Free Body Powder', brand: 'Himalaya' },
        { name: 'Moisturizing Hand Cream', brand: 'Vaseline' },
      ] },
      { slug: 'makeup', name: 'Makeup', code: 'MUP', priceRange: [199, 1999], products: [
        { name: 'Matte Liquid Lipstick', brand: 'Lakme' }, { name: 'Long-Wear Foundation', brand: 'Maybelline' },
        { name: 'Waterproof Kajal', brand: 'Lakme' }, { name: 'Compact Face Powder', brand: 'Lakme' },
        { name: 'Eyeshadow Palette', brand: 'Maybelline' },
      ] },
      { slug: 'grooming', name: 'Grooming', code: 'GRM', priceRange: [199, 2999], products: [
        { name: 'Electric Beard Trimmer', brand: 'Philips' }, { name: 'Aftershave Splash', brand: 'Old Spice' },
        { name: 'Charcoal Face Wash for Men', brand: 'Nivea Men' }, { name: 'Deodorant Body Spray', brand: 'Axe' },
        { name: 'Grooming Kit with Trimmer and Razor', brand: 'Gillette' },
      ] },
    ],
  },
  {
    slug: 'grocery-and-food', name: 'Grocery & Food', code: 'GROC', weightRangeKg: [0.1, 5],
    featureBlurb: 'a household grocery staple sourced for everyday cooking and snacking',
    subcategories: [
      { slug: 'snacks', name: 'Snacks', code: 'SNK', priceRange: [20, 299], products: [
        { name: 'Lays Classic Salted Potato Chips', brand: 'Lays' }, { name: 'Haldirams Aloo Bhujia', brand: 'Haldiram’s' },
        { name: 'Kurkure Masala Munch', brand: 'Kurkure' }, { name: 'Britannia Good Day Cookies', brand: 'Britannia' },
        { name: 'Bikaji Bhujia Sev', brand: 'Bikaji' },
      ] },
      { slug: 'beverages', name: 'Beverages', code: 'BEV', priceRange: [40, 599], products: [
        { name: 'Nescafe Classic Instant Coffee', brand: 'Nescafe' }, { name: 'Tata Tea Premium', brand: 'Tata Tea' },
        { name: 'Real Mixed Fruit Juice', brand: 'Real' }, { name: 'Bournvita Health Drink', brand: 'Cadbury' },
        { name: 'Sting Energy Drink Pack', brand: 'Sting' },
      ] },
      { slug: 'breakfast-foods', name: 'Breakfast Foods', code: 'BRK', priceRange: [79, 499], products: [
        { name: "Kellogg's Corn Flakes", brand: "Kellogg's" }, { name: 'Quaker Oats', brand: 'Quaker' },
        { name: 'MTR Instant Poha Mix', brand: 'MTR' }, { name: "Kellogg's Chocos", brand: "Kellogg's" },
        { name: 'Saffola Muesli', brand: 'Saffola' },
      ] },
      { slug: 'cooking-essentials', name: 'Cooking Essentials', code: 'CES', priceRange: [59, 999], products: [
        { name: 'Fortune Sunlite Refined Sunflower Oil', brand: 'Fortune' }, { name: 'Tata Salt', brand: 'Tata Salt' },
        { name: 'Aashirvaad Whole Wheat Atta', brand: 'Aashirvaad' }, { name: 'MDH Garam Masala', brand: 'MDH' },
        { name: 'India Gate Basmati Rice', brand: 'India Gate' },
      ] },
      { slug: 'packaged-foods', name: 'Packaged Foods', code: 'PKF', priceRange: [20, 399], products: [
        { name: 'Maggi 2-Minute Noodles', brand: 'Maggi' }, { name: 'Knorr Instant Soup', brand: 'Knorr' },
        { name: 'MTR Ready-to-Eat Meal', brand: 'MTR' }, { name: 'Amul Processed Cheese Slices', brand: 'Amul' },
        { name: 'Del Monte Pasta', brand: 'Del Monte' },
      ] },
    ],
  },
  {
    slug: 'home-and-kitchen', name: 'Home & Kitchen', code: 'HMKT', weightRangeKg: [0.3, 6],
    featureBlurb: 'a practical home essential built to make everyday household tasks easier',
    subcategories: [
      { slug: 'cookware', name: 'Cookware', code: 'CKW', priceRange: [399, 3999], products: [
        { name: 'Prestige Non-Stick Frying Pan', brand: 'Prestige' }, { name: 'Hawkins Stainless Steel Pressure Cooker', brand: 'Hawkins' },
        { name: 'Pigeon Cast Iron Skillet', brand: 'Pigeon' }, { name: 'Wonderchef Non-Stick Cookware Set', brand: 'Wonderchef' },
        { name: 'Prestige Induction Base Kadai', brand: 'Prestige' },
      ] },
      { slug: 'kitchen-storage', name: 'Kitchen Storage', code: 'KST', priceRange: [199, 1999], products: [
        { name: 'Milton Airtight Storage Container Set', brand: 'Milton' }, { name: 'Cello Modular Kitchen Storage Set', brand: 'Cello' },
        { name: 'Tupperware Airtight Container', brand: 'Tupperware' }, { name: 'Signoraware Fridge Storage Set', brand: 'Signoraware' },
        { name: 'Borosil Glass Storage Jar Set', brand: 'Borosil' },
      ] },
      { slug: 'dining-and-serveware', name: 'Dining & Serveware', code: 'DIN', priceRange: [499, 4999], products: [
        { name: 'Corelle Dinner Plate Set', brand: 'Corelle' }, { name: 'Borosil Glass Dinner Set', brand: 'Borosil' },
        { name: 'Cello Melamine Dinnerware Set', brand: 'Cello' }, { name: 'Larah Ceramic Serving Bowl Set', brand: 'Larah' },
        { name: 'Milton Stainless Steel Serving Set', brand: 'Milton' },
      ] },
      { slug: 'home-organization', name: 'Home Organization', code: 'ORG', priceRange: [299, 2999], products: [
        { name: 'Nilkamal Multipurpose Storage Rack', brand: 'Nilkamal' }, { name: 'Store More Modular Wardrobe Organizer', brand: 'Store More' },
        { name: 'Cello Novelty Shoe Rack', brand: 'Cello' }, { name: 'Amazon Brand Solimo Storage Boxes', brand: 'Solimo' },
        { name: 'Nilkamal Plastic Storage Drawer Unit', brand: 'Nilkamal' },
      ] },
      { slug: 'cleaning-supplies', name: 'Cleaning Supplies', code: 'CLN', priceRange: [49, 999], products: [
        { name: 'Scotch-Brite Scrub Pad Set', brand: 'Scotch-Brite' }, { name: 'Vim Dishwash Gel', brand: 'Vim' },
        { name: 'Harpic Toilet Cleaner', brand: 'Harpic' }, { name: 'Colin Glass Cleaner', brand: 'Colin' },
        { name: 'Lizol Floor Cleaner', brand: 'Lizol' },
      ] },
    ],
  },
  {
    slug: 'furniture', name: 'Furniture', code: 'FURN', weightRangeKg: [8, 45],
    featureBlurb: 'a sturdy furniture piece designed to fit comfortably into any home',
    subcategories: [
      { slug: 'sofas', name: 'Sofas', code: 'SOF', priceRange: [12999, 79999], products: [
        { name: '3-Seater Fabric Sofa', brand: 'Nilkamal' }, { name: 'L-Shape Corner Sofa Set', brand: 'Durian' },
        { name: '2-Seater Compact Sofa', brand: 'Urban Ladder' }, { name: 'Recliner Sofa Chair', brand: 'Durian' },
        { name: 'Fabric Sofa Cum Bed', brand: 'Nilkamal' },
      ] },
      { slug: 'beds', name: 'Beds', code: 'BED', priceRange: [8999, 49999], products: [
        { name: 'Queen Size Engineered Wood Bed', brand: 'Nilkamal' }, { name: 'King Size Storage Bed', brand: 'Urban Ladder' },
        { name: 'Single Bed with Drawer Storage', brand: 'Durian' }, { name: 'Upholstered Queen Size Bed', brand: 'Urban Ladder' },
        { name: 'Metal Bunk Bed', brand: 'Nilkamal' },
      ] },
      { slug: 'wardrobes', name: 'Wardrobes', code: 'WRD', priceRange: [7999, 44999], products: [
        { name: '3-Door Engineered Wood Wardrobe', brand: 'Nilkamal' }, { name: '2-Door Sliding Wardrobe', brand: 'Durian' },
        { name: 'Compact 2-Door Wardrobe', brand: 'Nilkamal' }, { name: '4-Door Wardrobe with Mirror', brand: 'Urban Ladder' },
        { name: 'Portable Fabric Wardrobe', brand: 'Cello' },
      ] },
      { slug: 'study-tables', name: 'Study Tables', code: 'STT', priceRange: [2999, 17999], products: [
        { name: 'Engineered Wood Study Table', brand: 'Nilkamal' }, { name: 'Foldable Study Table', brand: 'Cello' },
        { name: 'Study Table with Bookshelf', brand: 'Durian' }, { name: 'Compact Corner Study Desk', brand: 'Urban Ladder' },
        { name: 'Kids Study Table and Chair Set', brand: 'Nilkamal' },
      ] },
      { slug: 'chairs', name: 'Chairs', code: 'CHR', priceRange: [1499, 14999], products: [
        { name: 'Ergonomic Office Chair', brand: 'Green Soul' }, { name: 'Plastic Armchair', brand: 'Nilkamal' },
        { name: 'Wooden Dining Chair', brand: 'Durian' }, { name: 'Folding Chair Set of 2', brand: 'Cello' },
        { name: 'High Back Executive Chair', brand: 'Green Soul' },
      ] },
    ],
  },
  {
    slug: 'home-decor', name: 'Home Decor', code: 'HDEC', weightRangeKg: [0.1, 5],
    featureBlurb: 'a decorative accent piece designed to add character to any room',
    subcategories: [
      { slug: 'wall-decor', name: 'Wall Decor', code: 'WLD', priceRange: [299, 2999], products: [
        { name: 'Wooden Wall Hanging Clock Panel', brand: 'Fabindia' }, { name: 'Framed Wall Art Print Set', brand: 'WENS' },
        { name: 'Metal Wall Art Sculpture', brand: 'Aapno Rajasthan' }, { name: 'Handcrafted Mirror Wall Panel', brand: 'WENS' },
        { name: 'Wooden Wall Shelf Set', brand: 'Fabindia' },
      ] },
      { slug: 'lighting', name: 'Lighting', code: 'LGT', priceRange: [299, 3999], products: [
        { name: 'Decorative Table Lamp', brand: 'Philips' }, { name: 'LED Fairy String Lights', brand: 'Syska' },
        { name: 'Wooden Floor Lamp', brand: 'WENS' }, { name: 'Pendant Ceiling Light', brand: 'Havells' },
        { name: 'Rechargeable LED Lantern', brand: 'Syska' },
      ] },
      { slug: 'clocks', name: 'Clocks', code: 'CLK', priceRange: [399, 2499], products: [
        { name: 'Wooden Wall Clock', brand: 'Ajanta' }, { name: 'Digital Table Clock', brand: 'Ajanta' },
        { name: 'Vintage Style Wall Clock', brand: 'WENS' }, { name: 'Silent Sweep Wall Clock', brand: 'Ajanta' },
        { name: 'Modern Metal Wall Clock', brand: 'WENS' },
      ] },
      { slug: 'decorative-accessories', name: 'Decorative Accessories', code: 'DEC', priceRange: [199, 1999], products: [
        { name: 'Ceramic Flower Vase', brand: 'Fabindia' }, { name: 'Decorative Photo Frame Set', brand: 'WENS' },
        { name: 'Handcrafted Candle Holder Set', brand: 'Aapno Rajasthan' }, { name: 'Decorative Table Showpiece', brand: 'Fabindia' },
        { name: 'Scented Candle Gift Set', brand: 'WENS' },
      ] },
      { slug: 'artificial-plants', name: 'Artificial Plants', code: 'PLT', priceRange: [199, 1999], products: [
        { name: 'Artificial Bonsai Plant with Pot', brand: 'Fourwalls' }, { name: 'Artificial Areca Palm Plant', brand: 'Fourwalls' },
        { name: 'Artificial Money Plant with Vase', brand: 'Fabindia' }, { name: 'Artificial Bamboo Plant', brand: 'Fourwalls' },
        { name: 'Artificial Flower Bouquet', brand: 'Fabindia' },
      ] },
    ],
  },
  {
    slug: 'sports-and-fitness', name: 'Sports & Fitness', code: 'SPRT', weightRangeKg: [0.2, 20],
    featureBlurb: 'a fitness essential built to support a regular training routine',
    subcategories: [
      { slug: 'gym-equipment', name: 'Gym Equipment', code: 'GYM', priceRange: [499, 14999], products: [
        { name: 'Adjustable Dumbbell Set', brand: 'Kore' }, { name: 'Resistance Bands Set', brand: 'Boldfit' },
        { name: 'Foldable Manual Treadmill', brand: 'Cockatoo' }, { name: 'Home Gym Bench', brand: 'Kore' },
        { name: 'Skipping Rope with Counter', brand: 'Boldfit' },
      ] },
      { slug: 'yoga', name: 'Yoga', code: 'YOG', priceRange: [299, 2999], products: [
        { name: 'Non-Slip Yoga Mat', brand: 'Boldfit' }, { name: 'Yoga Block Set of 2', brand: 'Strauss' },
        { name: 'Meditation Cushion', brand: 'Fabindia' }, { name: 'Yoga Stretching Strap', brand: 'Boldfit' },
        { name: 'Yoga Wheel', brand: 'Strauss' },
      ] },
      { slug: 'running', name: 'Running', code: 'RUN', priceRange: [999, 7999], products: [
        { name: "Men's Running Shoes", brand: 'Nike' }, { name: 'Running Armband Phone Holder', brand: 'Boldfit' },
        { name: 'Moisture-Wicking Running T-Shirt', brand: 'Puma' }, { name: 'Running Shorts', brand: 'Adidas' },
        { name: 'GPS Running Sports Watch', brand: 'Garmin' },
      ] },
      { slug: 'outdoor-sports', name: 'Outdoor Sports', code: 'OUT', priceRange: [399, 4999], products: [
        { name: 'Badminton Racket Set of 2', brand: 'Yonex' }, { name: 'Football Size 5', brand: 'Nivia' },
        { name: 'Cricket Bat Kashmir Willow', brand: 'SG' }, { name: 'Table Tennis Paddle Set', brand: 'Stag' },
        { name: 'Basketball Size 7', brand: 'Nivia' },
      ] },
      { slug: 'fitness-accessories', name: 'Fitness Accessories', code: 'FAC', priceRange: [199, 3499], products: [
        { name: 'Fitness Gym Gloves', brand: 'Boldfit' }, { name: 'Shaker Bottle 700ml', brand: 'Cosco' },
        { name: 'Foam Roller for Muscle Recovery', brand: 'Strauss' }, { name: 'Fitness Tracker Band', brand: 'boAt' },
        { name: 'Waist Trainer Belt', brand: 'Boldfit' },
      ] },
    ],
  },
  {
    slug: 'toys-and-games', name: 'Toys & Games', code: 'TOYS', weightRangeKg: [0.2, 3],
    featureBlurb: 'a fun, engaging toy designed for hours of imaginative play',
    subcategories: [
      { slug: 'educational-toys', name: 'Educational Toys', code: 'EDU', priceRange: [299, 2499], products: [
        { name: 'Alphabet Learning Puzzle Board', brand: 'Funskool' }, { name: 'STEM Building Kit', brand: 'Skillmatics' },
        { name: 'Counting & Numbers Toy Set', brand: 'Funskool' }, { name: 'Interactive Learning Tablet Toy', brand: 'Chicco' },
        { name: 'Shape Sorting Toy', brand: 'Funskool' },
      ] },
      { slug: 'remote-control-toys', name: 'Remote Control Toys', code: 'RCT', priceRange: [599, 4999], products: [
        { name: 'Remote Control Racing Car', brand: 'Hot Wheels' }, { name: 'Remote Control Monster Truck', brand: 'Funskool' },
        { name: 'Remote Control Helicopter', brand: 'Flyer’s Bay' }, { name: 'Remote Control Robot Toy', brand: 'Toyshine' },
        { name: 'Remote Control Drift Car', brand: 'Hot Wheels' },
      ] },
      { slug: 'board-games', name: 'Board Games', code: 'BRD', priceRange: [299, 1999], products: [
        { name: 'Family Strategy Board Game', brand: 'Funskool' }, { name: 'Classic Trivia Board Game', brand: 'Mattel' },
        { name: 'Kids Snakes & Ladders Set', brand: 'Funskool' }, { name: 'Word Guessing Board Game', brand: 'Mattel' },
        { name: 'Chess and Checkers Set', brand: 'Funskool' },
      ] },
      { slug: 'action-figures', name: 'Action Figures', code: 'ACF', priceRange: [299, 2999], products: [
        { name: 'Superhero Action Figure Set', brand: 'Marvel' }, { name: 'Collectible Action Figure', brand: 'DC' },
        { name: 'Articulated Action Figure', brand: 'Hasbro' }, { name: 'Movie Character Action Figure', brand: 'Marvel' },
        { name: 'Action Figure Playset', brand: 'Hasbro' },
      ] },
      { slug: 'outdoor-games', name: 'Outdoor Games', code: 'OGM', priceRange: [399, 4999], products: [
        { name: "Kids' Bicycle", brand: 'BSA' }, { name: 'Water Gun Set', brand: 'Toyshine' },
        { name: "Kids' Trampoline", brand: 'Funskool' }, { name: 'Ride-On Toy Car', brand: 'Toyshine' },
        { name: 'Kite Set', brand: 'Funskool' },
      ] },
    ],
  },
  {
    slug: 'baby-and-kids', name: 'Baby & Kids', code: 'BABY', weightRangeKg: [0.1, 5],
    featureBlurb: 'a gentle, baby-safe essential for everyday care',
    subcategories: [
      { slug: 'baby-clothing', name: 'Baby Clothing', code: 'CLO', priceRange: [249, 1299], products: [
        { name: 'Soft Cotton Infant Bodysuit Set', brand: 'Mothercare' }, { name: 'Newborn Sleepsuit Set', brand: 'Fisher-Price' },
        { name: 'Infant Romper with Cap', brand: 'Mothercare' }, { name: 'Organic Cotton Baby Onesie', brand: 'Chicco' },
        { name: 'Infant Swaddle Wrap Set', brand: 'Fisher-Price' },
      ] },
      { slug: 'baby-care', name: 'Baby Care', code: 'CAR', priceRange: [149, 1499], products: [
        { name: 'Baby Shampoo & Body Wash', brand: 'Johnson’s Baby' }, { name: 'Baby Lotion', brand: 'Himalaya' },
        { name: 'Baby Massage Oil', brand: 'Johnson’s Baby' }, { name: 'Baby Diaper Rash Cream', brand: 'Himalaya' },
        { name: 'Baby Powder', brand: 'Johnson’s Baby' },
      ] },
      { slug: 'feeding-essentials', name: 'Feeding Essentials', code: 'FED', priceRange: [199, 2499], products: [
        { name: 'Baby Feeding Bottle Set', brand: 'Chicco' }, { name: 'Silicone Baby Bib', brand: 'Mothercare' },
        { name: 'Baby Food Steamer & Blender', brand: 'Philips Avent' }, { name: 'Sipper Cup for Toddlers', brand: 'Chicco' },
        { name: 'Baby Bottle Sterilizer', brand: 'Philips Avent' },
      ] },
      { slug: 'school-supplies', name: 'School Supplies', code: 'SCH', priceRange: [49, 999], products: [
        { name: 'School Backpack for Kids', brand: 'American Tourister' }, { name: 'Geometry Box Set', brand: 'Camlin' },
        { name: 'Wax Crayons Set', brand: 'Camlin' }, { name: 'School Water Bottle', brand: 'Milton' },
        { name: 'Kids Pencil Box', brand: 'Doms' },
      ] },
      { slug: 'kids-accessories', name: 'Kids Accessories', code: 'KAC', priceRange: [99, 999], products: [
        { name: 'Kids Sunglasses', brand: 'Fastrack' }, { name: 'Kids Analog Wrist Watch', brand: 'Fastrack' },
        { name: 'Kids Raincoat Set', brand: 'Cortina' }, { name: 'Kids Woolen Cap and Gloves Set', brand: 'Mothercare' },
        { name: 'Kids Hair Accessories Set', brand: 'Fabindia' },
      ] },
    ],
  },
  {
    slug: 'books-and-stationery', name: 'Books & Stationery', code: 'BOOK', weightRangeKg: [0.1, 0.8],
    featureBlurb: 'a well-made reading or stationery essential for study, work, and leisure',
    subcategories: [
      { slug: 'fiction-books', name: 'Fiction Books', code: 'FIC', priceRange: [199, 799], products: [
        { name: 'Contemporary Fiction Novel', brand: 'Penguin' }, { name: 'Mystery Thriller Paperback', brand: 'HarperCollins' },
        { name: 'Romance Fiction Bestseller', brand: 'Penguin' }, { name: 'Historical Fiction Novel', brand: 'HarperCollins' },
        { name: 'Fantasy Adventure Novel', brand: 'Penguin' },
      ] },
      { slug: 'non-fiction-books', name: 'Non-Fiction Books', code: 'NFC', priceRange: [249, 999], products: [
        { name: 'Self-Help Motivational Book', brand: 'Penguin' }, { name: 'Biography Paperback', brand: 'HarperCollins' },
        { name: 'Personal Finance Guide Book', brand: 'Penguin' }, { name: 'Popular History Book', brand: 'HarperCollins' },
        { name: 'Popular Science Book', brand: 'Penguin' },
      ] },
      { slug: 'educational-books', name: 'Educational Books', code: 'EDB', priceRange: [199, 1499], products: [
        { name: 'CBSE Mathematics Textbook', brand: 'NCERT' }, { name: 'General Knowledge Guide Book', brand: "Arihant" },
        { name: 'Competitive Exam Preparation Book', brand: "Arihant" }, { name: 'English Grammar Practice Book', brand: 'Oxford' },
        { name: 'Science Reference Guide', brand: 'Oxford' },
      ] },
      { slug: 'notebooks-and-journals', name: 'Notebooks & Journals', code: 'NBK', priceRange: [49, 499], products: [
        { name: 'Hardbound Ruled Notebook', brand: 'Classmate' }, { name: 'Spiral Bound Notebook Set', brand: 'Navneet' },
        { name: 'Leather Cover Journal Diary', brand: 'Classmate' }, { name: 'Pocket Notebook Pack', brand: 'Navneet' },
        { name: 'A5 Dotted Bullet Journal', brand: 'Classmate' },
      ] },
      { slug: 'office-stationery', name: 'Office Stationery', code: 'OFS', priceRange: [39, 599], products: [
        { name: 'Gel Pen Set of 10', brand: 'Cello' }, { name: 'Stapler with Pins', brand: 'Kangaro' },
        { name: 'Sticky Notes Pack', brand: '3M' }, { name: 'Desk Organizer Tray', brand: 'Solo' },
        { name: 'Whiteboard Marker Set', brand: 'Camlin' },
      ] },
    ],
  },
  {
    slug: 'automotive', name: 'Automotive', code: 'AUTO', weightRangeKg: [0.2, 8],
    featureBlurb: 'a practical automotive accessory built for regular vehicle use',
    subcategories: [
      { slug: 'car-accessories', name: 'Car Accessories', code: 'CAA', priceRange: [299, 3999], products: [
        { name: 'Car Dashboard Camera', brand: '70mai' }, { name: 'Car Seat Cover Set', brand: 'Elegant' },
        { name: 'Car Phone Mount Holder', brand: 'AmazonBasics' }, { name: 'Car Air Freshener Set', brand: 'Godrej aer' },
        { name: 'Car Floor Mats Set', brand: 'Elegant' },
      ] },
      { slug: 'bike-accessories', name: 'Bike Accessories', code: 'BKA', priceRange: [199, 2499], products: [
        { name: 'Bike Mobile Holder', brand: 'Zadon' }, { name: 'Bike Seat Cover', brand: 'Zadon' },
        { name: 'Bike LED Headlight', brand: 'Philips' }, { name: 'Bike Riding Gloves', brand: 'Royal Enfield' },
        { name: 'Waterproof Bike Cover', brand: 'Zadon' },
      ] },
      { slug: 'car-care', name: 'Car Care', code: 'CCR', priceRange: [149, 1499], products: [
        { name: 'Car Wash Shampoo', brand: '3M' }, { name: 'Car Wax Polish', brand: 'Turtle Wax' },
        { name: 'Microfiber Cleaning Cloth Set', brand: '3M' }, { name: 'Tyre Shine Spray', brand: 'Turtle Wax' },
        { name: 'Car Interior Dashboard Cleaner', brand: '3M' },
      ] },
      { slug: 'interior-accessories', name: 'Interior Accessories', code: 'INT', priceRange: [199, 2999], products: [
        { name: 'Car Steering Wheel Cover', brand: 'Elegant' }, { name: 'Car Seat Cushion', brand: 'AutoFurnish' },
        { name: 'Car Organizer Back Seat', brand: 'AmazonBasics' }, { name: 'Car Sunshade Curtain Set', brand: 'AutoFurnish' },
        { name: 'Car Neck Pillow Set', brand: 'Elegant' },
      ] },
      { slug: 'vehicle-electronics', name: 'Vehicle Electronics', code: 'VEL', priceRange: [499, 6999], products: [
        { name: 'Car Tyre Inflator', brand: '70mai' }, { name: 'Bluetooth FM Transmitter for Car', brand: 'boAt' },
        { name: 'Car Reverse Parking Sensor Kit', brand: 'Autofy' }, { name: 'Car Battery Jump Starter', brand: 'Autofy' },
        { name: 'Car Charger with Dual USB', brand: 'boAt' },
      ] },
    ],
  },
  {
    slug: 'travel-and-luggage', name: 'Travel & Luggage', code: 'TRVL', weightRangeKg: [0.3, 5],
    featureBlurb: 'a travel-ready essential built to handle regular trips with ease',
    subcategories: [
      { slug: 'suitcases', name: 'Suitcases', code: 'SUI', priceRange: [1999, 12999], products: [
        { name: 'Hard Shell Cabin Suitcase', brand: 'American Tourister' }, { name: 'Large Checked-In Suitcase', brand: 'Safari' },
        { name: 'Medium Hard Shell Suitcase', brand: 'VIP' }, { name: 'Expandable Soft Sided Suitcase', brand: 'Skybags' },
        { name: '4-Wheel Spinner Trolley Suitcase', brand: 'American Tourister' },
      ] },
      { slug: 'backpacks', name: 'Backpacks', code: 'BPK', priceRange: [699, 3999], isVariable: true, variantAxis: 'size', products: [
        { name: 'Laptop Backpack', brand: 'Skybags' }, { name: 'Casual College Backpack', brand: 'Wildcraft' },
        { name: 'Waterproof Travel Backpack', brand: 'American Tourister' }, { name: 'Anti-Theft Backpack', brand: 'Safari' },
        { name: 'Hiking Backpack 40L', brand: 'Wildcraft' },
      ] },
      { slug: 'travel-bags', name: 'Travel Bags', code: 'TBG', priceRange: [899, 3999], products: [
        { name: 'Duffel Travel Bag', brand: 'Wildcraft' }, { name: 'Weekend Travel Duffel Bag', brand: 'American Tourister' },
        { name: 'Foldable Travel Duffel', brand: 'Safari' }, { name: 'Travel Tote Bag', brand: 'Skybags' },
        { name: 'Gym and Travel Duffel Bag', brand: 'Wildcraft' },
      ] },
      { slug: 'travel-accessories', name: 'Travel Accessories', code: 'TAC', priceRange: [149, 1999], products: [
        { name: 'Travel Neck Pillow', brand: 'AmazonBasics' }, { name: 'Luggage Weighing Scale', brand: 'Safari' },
        { name: 'Travel Adapter Universal Plug', brand: 'Portronics' }, { name: 'Passport Holder Wallet', brand: 'Wildcraft' },
        { name: 'Travel Pouch Organizer Set', brand: 'Safari' },
      ] },
      { slug: 'travel-organizers', name: 'Travel Organizers', code: 'TOR', priceRange: [199, 1999], products: [
        { name: 'Packing Cubes Set of 4', brand: 'Wildcraft' }, { name: 'Toiletry Travel Kit Bag', brand: 'Safari' },
        { name: 'Shoe Storage Travel Bag', brand: 'American Tourister' }, { name: 'Cable and Gadget Organizer Pouch', brand: 'Portronics' },
        { name: 'Compression Packing Bags Set', brand: 'Skybags' },
      ] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const TAG_POOL = [
  'New Arrival', 'Best Seller', 'Trending', 'Premium', 'Budget Friendly',
  'Work From Home', 'Travel Essential', 'Fitness', 'Summer Collection', 'Winter Collection',
];

// ---------------------------------------------------------------------------
// Attribute value sets for VARIABLE products
// ---------------------------------------------------------------------------

const SIZE_VALUES = ['S', 'M', 'L', 'XL'];
const SHOE_SIZE_VALUES = ['6', '7', '8', '9', '10'];
const COLOR_VALUES = ['Black', 'White', 'Blue', 'Grey'];

// ---------------------------------------------------------------------------
// Image generation (same approach as v1: real, valid, clearly-labeled demo JPEGs)
// ---------------------------------------------------------------------------

const VIEW_LABELS = ['Main View', 'Side View', 'Detail View', 'Lifestyle View'];

function hashColor(seed: string): { bg: string; accent: string } {
  const palette: [string, string][] = [
    ['#1f2937', '#60a5fa'], ['#831843', '#f9a8d4'], ['#78350f', '#fbbf24'], ['#134e4a', '#5eead4'],
    ['#111827', '#818cf8'], ['#312e81', '#a5b4fc'], ['#292524', '#fb923c'], ['#14532d', '#86efac'],
    ['#451a03', '#fcd34d'], ['#365314', '#bef264'], ['#3f2d1c', '#d6b98c'], ['#3f1d1d', '#fbbf24'],
    ['#1c1917', '#f87171'], ['#422006', '#fdba74'], ['#701a75', '#f0abfc'], ['#164e63', '#67e8f9'],
    ['#155e75', '#a5f3fc'], ['#1e1b4b', '#c4b5fd'], ['#7f1d1d', '#fca5a5'], ['#0f172a', '#38bdf8'],
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const [bg, accent] = palette[hash % palette.length];
  return { bg, accent };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

async function generateProductImage(productName: string, viewLabel: string, seed: string): Promise<Buffer> {
  const colors = hashColor(seed);
  const size = 900;
  const lines = wrapText(productName);
  const startY = size / 2 - ((lines.length - 1) * 27);
  const textSvg = lines
    .map((line, i) => `<text x="${size / 2}" y="${startY + i * 54}" font-size="38" font-family="Arial, sans-serif" fill="#ffffff" text-anchor="middle" font-weight="700">${escapeXml(line)}</text>`)
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

function buildShortDescription(name: string, subcategoryName: string, brand: string): string {
  return `${name} from ${brand} - ${subcategoryName === name ? 'a' : 'a'} popular pick in our ${subcategoryName} range, chosen for everyday quality and value.`;
}

function buildDescription(name: string, subcategoryName: string, categoryName: string, brand: string, featureBlurb: string): string {
  return (
    `The ${name} by ${brand} is ${featureBlurb}. As part of Peshani's ${categoryName} range, it's built for reliable, everyday use in the ${subcategoryName} category, ` +
    `combining sensible design with dependable performance. Explore more from our ${categoryName} catalog for related picks that fit the same use case.`
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface RunStats {
  oldProductsDeleted: number;
  oldCategoriesDeleted: number;
  brandsUpserted: number;
  attributesCreated: number;
  productsCreated: number;
  productsSkippedExisting: number;
  variantsCreated: number;
  imagesUploaded: number;
  inventoryInitialized: number;
  errors: { sku: string; message: string }[];
}

async function main() {
  const stats: RunStats = {
    oldProductsDeleted: 0, oldCategoriesDeleted: 0, brandsUpserted: 0, attributesCreated: 0,
    productsCreated: 0, productsSkippedExisting: 0, variantsCreated: 0, imagesUploaded: 0,
    inventoryInitialized: 0, errors: [],
  };

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const prisma = app.get(PrismaService);
    const productsService = app.get(ProductsService);
    const variantsService = app.get(ProductVariantsService);
    const productImagesService = app.get(ProductImagesService);
    const inventoryService = app.get(InventoryService);

    const store = await prisma.store.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!store) throw new Error('No store found');
    const storeId = store.id;

    const adminUser = await prisma.user.findFirst({ where: { storeId, type: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
    if (!adminUser) throw new Error('No ADMIN user found in this store');
    const actor: AuthenticatedUser = { userId: adminUser.id, storeId, email: adminUser.email, type: 'ADMIN', roles: ['SUPER_ADMIN'], permissions: [] };

    // ---- Step 1: safety check + cleanup of the OLD demo catalog ----
    const oldProducts = await prisma.product.findMany({ where: { storeId, sku: { not: null } }, select: { id: true, sku: true } });
    const oldProductIds = oldProducts.filter((p) => OLD_SKU_PATTERN.test(p.sku ?? '')).map((p) => p.id);

    const refCounts = await Promise.all([
      prisma.orderItem.count({ where: { productId: { in: oldProductIds } } }),
      prisma.productReview.count({ where: { productId: { in: oldProductIds } } }),
      prisma.wishlistItem.count({ where: { productId: { in: oldProductIds } } }),
      prisma.cartItem.count({ where: { productId: { in: oldProductIds } } }),
      prisma.promotionProduct.count({ where: { productId: { in: oldProductIds } } }),
    ]);
    const [orderRefs, reviewRefs, wishlistRefs, cartRefs, promoRefs] = refCounts;
    if (orderRefs || reviewRefs || wishlistRefs || cartRefs || promoRefs) {
      throw new Error(
        `Refusing to delete: old catalog products are referenced by business data ` +
        `(orders=${orderRefs}, reviews=${reviewRefs}, wishlist=${wishlistRefs}, cart=${cartRefs}, promotions=${promoRefs}). ` +
        `Investigate before proceeding.`,
      );
    }

    if (oldProductIds.length > 0) {
      const deleted = await prisma.product.deleteMany({ where: { id: { in: oldProductIds } } });
      stats.oldProductsDeleted = deleted.count;
      console.log(`Deleted ${deleted.count} old catalog products (cascades images/inventory/category-links).`);
    }

    const oldCategories = await prisma.category.findMany({
      where: { storeId, deletedAt: null, OR: [{ slug: { in: OLD_CATEGORY_SLUGS } }, { parent: { slug: { in: OLD_CATEGORY_SLUGS } } }] },
      select: { id: true },
    });
    if (oldCategories.length > 0) {
      const deletedCats = await prisma.category.deleteMany({ where: { id: { in: oldCategories.map((c) => c.id) } } });
      stats.oldCategoriesDeleted = deletedCats.count;
      console.log(`Deleted ${deletedCats.count} old categories/subcategories.`);
    }

    // ---- Step 2: brands (upsert by slug, reused across products) ----
    const allBrandNames = new Set<string>();
    for (const category of CATEGORIES) {
      for (const sub of category.subcategories) {
        for (const product of sub.products) allBrandNames.add(product.brand);
      }
    }
    const brandIdByName = new Map<string, string>();
    for (const brandName of allBrandNames) {
      const slug = slugify(brandName);
      const brand = await prisma.brand.upsert({
        where: { storeId_slug: { storeId, slug } },
        update: {},
        create: { storeId, name: brandName, slug, isActive: true },
      });
      brandIdByName.set(brandName, brand.id);
      stats.brandsUpserted += 1;
    }
    console.log(`Upserted ${stats.brandsUpserted} brands.`);

    // ---- Step 3: attributes (Size, Shoe Size, Color) ----
    async function upsertAttributeWithValues(name: string, values: string[]) {
      const slug = slugify(name);
      const attribute = await prisma.attribute.upsert({
        where: { storeId_slug: { storeId, slug } },
        update: {},
        create: { storeId, name, slug, type: 'SELECT', isActive: true },
      });
      const valueIds: Record<string, string> = {};
      for (const [index, value] of values.entries()) {
        const valueSlug = slugify(value);
        const row = await prisma.attributeValue.upsert({
          where: { attributeId_slug: { attributeId: attribute.id, slug: valueSlug } },
          update: {},
          create: { attributeId: attribute.id, value, slug: valueSlug, sortOrder: index, isActive: true },
        });
        valueIds[value] = row.id;
      }
      return { attributeId: attribute.id, valueIds };
    }

    const sizeAttr = await upsertAttributeWithValues('Size', SIZE_VALUES);
    const shoeSizeAttr = await upsertAttributeWithValues('Shoe Size', SHOE_SIZE_VALUES);
    const colorAttr = await upsertAttributeWithValues('Color', COLOR_VALUES);
    stats.attributesCreated = 3;
    console.log('Attributes ready: Size, Shoe Size, Color.');

    // ---- Step 4: new category tree ----
    const categoryRowBySlug = new Map<string, { id: string; name: string }>();
    const subcategoryRowBySlug = new Map<string, { id: string; name: string; parentSlug: string }>();

    for (const [catIndex, category] of CATEGORIES.entries()) {
      // Negative sortOrder: this shared dev database accumulates dozens of
      // e2e-test-fixture categories that default to sortOrder 0 (see the
      // Category schema default) and never clean up after themselves. The
      // storefront's homepage mega menu shows "the first N categories by
      // sortOrder" with no other filter, so without this, freshly-seeded
      // real categories lose every tiebreak against that debris and never
      // actually appear in primary navigation.
      const sortOrder = catIndex - CATEGORIES.length;
      const catRow = await prisma.category.upsert({
        where: { storeId_slug: { storeId, slug: category.slug } },
        update: { sortOrder },
        create: { storeId, name: category.name, slug: category.slug, sortOrder, isActive: true, isFeatured: true },
      });
      categoryRowBySlug.set(category.slug, { id: catRow.id, name: catRow.name });

      for (const [subIndex, sub] of category.subcategories.entries()) {
        const subRow = await prisma.category.upsert({
          where: { storeId_slug: { storeId, slug: sub.slug } },
          update: {},
          create: { storeId, name: sub.name, slug: sub.slug, parentId: catRow.id, sortOrder: subIndex, isActive: true },
        });
        subcategoryRowBySlug.set(sub.slug, { id: subRow.id, name: subRow.name, parentSlug: category.slug });
      }
    }
    console.log(`Category tree ready: ${categoryRowBySlug.size} categories, ${subcategoryRowBySlug.size} subcategories.`);

    // ---- Step 5: products, variants, images, inventory ----
    let globalProductIndex = 0;

    for (const category of CATEGORIES) {
      const categoryRow = categoryRowBySlug.get(category.slug)!;

      for (const sub of category.subcategories) {
        const subRow = subcategoryRowBySlug.get(sub.slug)!;

        for (const [i, productSpec] of sub.products.entries()) {
          const sku = sub.isVariable ? undefined : `${category.code}-${sub.code}-${String(i + 1).padStart(3, '0')}`;
          const slug = slugify(productSpec.name) + (sub.isVariable ? `-${sub.code.toLowerCase()}-${i + 1}` : '');

          // idempotency check: by slug (VARIABLE has no top-level sku) or sku (SIMPLE)
          const existing = sku
            ? await prisma.product.findFirst({ where: { storeId, sku } })
            : await prisma.product.findFirst({ where: { storeId, slug } });
          if (existing) {
            stats.productsSkippedExisting += 1;
            globalProductIndex += 1;
            continue;
          }

          try {
            const price = randomInt(sub.priceRange[0], sub.priceRange[1]);
            const hasCompareAt = Math.random() < 0.3;
            const compareAtPrice = hasCompareAt ? Math.round(price * (1.15 + Math.random() * 0.25)) : undefined;
            const weight = (Math.random() * (category.weightRangeKg[1] - category.weightRangeKg[0]) + category.weightRangeKg[0]).toFixed(3);
            const brandId = brandIdByName.get(productSpec.brand);
            const tags = [TAG_POOL[globalProductIndex % TAG_POOL.length], category.name];

            const attributeIds: string[] = [];
            if (sub.isVariable) {
              attributeIds.push(sub.variantAxis === 'shoeSize' ? shoeSizeAttr.attributeId : sizeAttr.attributeId);
              attributeIds.push(colorAttr.attributeId);
            }

            const product = await productsService.create(
              storeId,
              {
                name: productSpec.name,
                slug,
                productType: sub.isVariable ? 'VARIABLE' : 'SIMPLE',
                sku,
                shortDescription: buildShortDescription(productSpec.name, sub.name, productSpec.brand),
                description: buildDescription(productSpec.name, sub.name, category.name, productSpec.brand, category.featureBlurb),
                basePrice: price.toFixed(2),
                compareAtPrice: sub.isVariable ? undefined : compareAtPrice?.toFixed(2),
                weight,
                status: 'ACTIVE',
                brandId,
                categoryIds: [categoryRow.id, subRow.id],
                tagNames: tags,
                attributeIds: sub.isVariable ? attributeIds : undefined,
                seoTitle: productSpec.name,
                seoDescription: buildShortDescription(productSpec.name, sub.name, productSpec.brand),
              },
              actor,
            );
            stats.productsCreated += 1;

            // images (2-4, mixture)
            const imageCount = [2, 3, 4][globalProductIndex % 3];
            for (let v = 0; v < imageCount; v += 1) {
              const buffer = await generateProductImage(productSpec.name, VIEW_LABELS[v], category.slug);
              const file = {
                buffer, mimetype: 'image/jpeg', size: buffer.length, originalname: `${product.slug}-${v + 1}.jpg`,
              } as Express.Multer.File;
              await productImagesService.upload(storeId, product.id, file, { altText: `${productSpec.name} - ${VIEW_LABELS[v]}` }, actor);
              stats.imagesUploaded += 1;
            }

            if (sub.isVariable) {
              // 2 colors x 2 sizes = 4 variants per variable product
              const sizeValues = (sub.variantAxis === 'shoeSize' ? SHOE_SIZE_VALUES : SIZE_VALUES).slice(1, 3);
              const colorValues = COLOR_VALUES.slice(0, 2);
              const sizeAttrRef = sub.variantAxis === 'shoeSize' ? shoeSizeAttr : sizeAttr;

              for (const sizeValue of sizeValues) {
                for (const colorValue of colorValues) {
                  const variantSku = `${slug.toUpperCase()}-${sizeValue}-${colorValue.slice(0, 3).toUpperCase()}`;
                  const variant = await variantsService.create(
                    storeId,
                    product.id,
                    {
                      sku: variantSku,
                      price: price.toFixed(2),
                      compareAtPrice: compareAtPrice?.toFixed(2),
                      attributeValueIds: [sizeAttrRef.valueIds[sizeValue], colorAttr.valueIds[colorValue]],
                    },
                    actor,
                  );
                  stats.variantsCreated += 1;

                  await inventoryService.initialize(
                    storeId,
                    { warehouseId: (await getMainWarehouse(prisma, storeId)).id, productId: product.id, variantId: variant.id, quantity: randomInt(10, 60), lowStockThreshold: 5 },
                    actor,
                  );
                  stats.inventoryInitialized += 1;
                }
              }
            } else {
              await inventoryService.initialize(
                storeId,
                { warehouseId: (await getMainWarehouse(prisma, storeId)).id, productId: product.id, quantity: randomInt(25, 150), lowStockThreshold: 10 },
                actor,
              );
              stats.inventoryInitialized += 1;
            }
          } catch (error) {
            stats.errors.push({ sku: sku ?? slug, message: error instanceof Error ? error.message : String(error) });
            console.error(`FAILED: ${sku ?? slug} (${productSpec.name}):`, error instanceof Error ? error.message : error);
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

let cachedWarehouseId: { id: string } | null = null;
async function getMainWarehouse(prisma: PrismaService, storeId: string) {
  if (cachedWarehouseId) return cachedWarehouseId;
  const warehouse = await prisma.warehouse.upsert({
    where: { storeId_code: { storeId, code: 'MAIN' } },
    update: {},
    create: { storeId, name: 'Main Warehouse', code: 'MAIN', isDefault: true, isActive: true },
  });
  cachedWarehouseId = { id: warehouse.id };
  return cachedWarehouseId;
}

main().catch((err) => {
  console.error('Fatal error running seed-catalog-v2:', err);
  process.exitCode = 1;
});
