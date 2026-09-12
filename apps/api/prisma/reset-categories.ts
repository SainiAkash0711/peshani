import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES: { name: string; subcategories: string[] }[] = [
  { name: "Men's Fashion", subcategories: ['T-Shirts & Polos', 'Shirts', 'Jeans', 'Trousers', 'Jackets'] },
  { name: "Women's Fashion", subcategories: ['Dresses', 'Tops & Tunics', 'Sarees', 'Kurtas & Suits', 'Leggings'] },
  { name: "Kids Fashion", subcategories: ['Boys Clothing', 'Girls Clothing', 'Infant Wear', 'School Uniforms', 'Kids Footwear'] },
  { name: 'Home & Kitchen', subcategories: ['Cookware', 'Dinnerware', 'Storage & Containers', 'Home Decor', 'Bedding'] },
  { name: 'Electronics', subcategories: ['Televisions', 'Laptops', 'Cameras', 'Speakers & Audio', 'Smart Home'] },
  { name: 'Mobile Accessories', subcategories: ['Cases & Covers', 'Chargers & Cables', 'Power Banks', 'Screen Protectors', 'Bluetooth Devices'] },
  { name: 'Beauty & Health', subcategories: ['Skincare', 'Haircare', 'Makeup', 'Personal Care', 'Health Supplements'] },
  { name: 'Automotive', subcategories: ['Car Accessories', 'Bike Accessories', 'Car Care', 'Helmets', 'Tyres & Wheels'] },
  { name: 'Sports & Fitness', subcategories: ['Gym Equipment', 'Sportswear', 'Cycling', 'Yoga & Meditation', 'Outdoor Sports'] },
  { name: 'Books & Stationery', subcategories: ['Fiction', 'Non-Fiction', 'Notebooks & Diaries', 'Office Supplies', 'Art Supplies'] },
  { name: 'Groceries', subcategories: ['Fruits & Vegetables', 'Snacks & Beverages', 'Staples', 'Dairy & Bakery', 'Packaged Foods'] },
  { name: 'Furniture', subcategories: ['Living Room', 'Bedroom', 'Office Furniture', 'Storage Units', 'Outdoor Furniture'] },
  { name: 'Jewellery', subcategories: ['Earrings', 'Necklaces', 'Rings', 'Bracelets', 'Fashion Jewellery'] },
  { name: 'Footwear', subcategories: ['Casual Shoes', 'Formal Shoes', 'Sports Shoes', 'Sandals & Flip Flops', 'Boots'] },
  { name: 'Bags & Luggage', subcategories: ['Backpacks', 'Handbags', 'Travel Bags', 'Wallets', 'Laptop Bags'] },
  { name: 'Toys & Games', subcategories: ['Action Figures', 'Educational Toys', 'Board Games', 'Outdoor Toys', 'Building Blocks'] },
  { name: 'Pet Supplies', subcategories: ['Dog Food', 'Cat Food', 'Pet Toys', 'Pet Grooming', 'Pet Accessories'] },
  { name: 'Baby Care', subcategories: ['Diapers & Wipes', 'Baby Feeding', 'Baby Bath & Skincare', 'Baby Gear', 'Baby Toys'] },
  { name: 'Musical Instruments', subcategories: ['Guitars', 'Keyboards & Pianos', 'Drums & Percussion', 'Wind Instruments', 'Studio Equipment'] },
  { name: 'Gifts & Occasions', subcategories: ['Gift Cards', 'Party Supplies', 'Festive Decor', 'Personalized Gifts', 'Greeting Cards'] },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const store = await prisma.store.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!store) throw new Error('No store found');

  const deleted = await prisma.category.deleteMany({ where: { storeId: store.id } });
  console.log(`Deleted ${deleted.count} existing categories/subcategories.`);

  for (const [index, category] of CATEGORIES.entries()) {
    await prisma.category.create({
      data: {
        storeId: store.id,
        name: category.name,
        slug: slugify(category.name),
        sortOrder: index,
        isActive: true,
        isFeatured: true,
        children: {
          create: category.subcategories.map((name, subIndex) => ({
            storeId: store.id,
            name,
            slug: slugify(`${category.name}-${name}`),
            sortOrder: subIndex,
            isActive: true,
          })),
        },
      },
    });
  }

  console.log(`Created ${CATEGORIES.length} categories with ${CATEGORIES.length * 5} subcategories.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
