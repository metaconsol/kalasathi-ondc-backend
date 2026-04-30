import { db } from './src/lib/db';

async function seed() {
  try {
    // 1. Create a user
    const user = await db.user.upsert({
      where: { phoneNumber: '+919999999999' },
      update: {},
      create: {
        name: 'Dev Seller',
        phoneNumber: '+919999999999',
        role: 'SELLER',
      },
    });

    console.log('User created:', user.id);

    // 2. Create a seller profile
    await db.sellerProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
      },
    });

    // 3. Create a store
    const store = await db.store.upsert({
      where: { storeSlug: 'local-dev-store-1' },
      update: {},
      create: {
        sellerUserId: user.id,
        storeName: 'Local Dev Store',
        storeSlug: 'local-dev-store-1',
        isActive: true,
      },
    });
    console.log('Store created:', store.id);

    // 4. Create a category
    const category = await db.category.upsert({
      where: { slug: 'local-dev-category-1' },
      update: {},
      create: {
        name: 'Local Dev Category',
        slug: 'local-dev-category-1',
        isActive: true,
      },
    });
    console.log('Category created:', category.id);

    // 5. Create a product
    let product = await db.product.findUnique({
      where: { aliasSlug: 'local-dev-demo-product' },
      include: {
        variants: true,
      },
    });

    if (!product) {
      product = await db.product.create({
        data: {
          storeId: store.id,
          categoryId: category.id,
          productName: 'ODOP Demo Product',
          district: 'Bhopal',
          description: 'Dummy product for checkout and order integration testing.',
          brand: 'ODOP Demo',
          defaultPrice: 100.0,
          mrp: 150.0,
          stock: 100n,
          publishStatus: 'publish',
          aliasSlug: 'local-dev-demo-product',
          variants: {
            create: {
              variantName: 'Default Variant',
              sku: 'LOCAL-DEV-DEMO-SKU-1',
              price: 100.0,
              mrp: 150.0,
            },
          },
        },
        include: {
          variants: true,
        },
      });
      console.log(
        'Product created:',
        product.id,
        'with variants:',
        product.variants.map((v) => v.id),
      );
    } else {
      console.log('Product already exists:', product.id);
    }

    // 6. Seed States and Districts
    console.log('Seeding States and Districts...');
    const statesData = (
      await import('./src/data/states-districts.json', { assert: { type: 'json' } })
    ).default;

    interface StateData {
      name: string;
      code: string;
      districts: string[];
    }

    for (const state of statesData as StateData[]) {
      const createdState = await db.state.upsert({
        where: { name: state.name },
        update: { code: state.code },
        create: {
          name: state.name,
          code: state.code,
        },
      });

      for (const district of state.districts) {
        await db.district.upsert({
          where: {
            id:
              (await db.district.findFirst({ where: { name: district, stateId: createdState.id } }))
                ?.id || -1,
          },
          update: {},
          create: {
            name: district,
            stateId: createdState.id,
          },
        });
      }
    }
    console.log('States and Districts seeded successfully!');

    console.log('Seed completed successfully!');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Seed error:', message);
  } finally {
    process.exit(0);
  }
}

seed();
