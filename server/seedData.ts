import type {
  SchemaGraph,
  CiRunDTO,
  MigrationDTO,
  WebhookDTO,
  TagDTO,
} from '../src/types/schema.ts';

export const BASELINE_INVENTORY_SCHEMA: SchemaGraph = {
  dialect: 'postgresql',
  nodes: [
    {
      id: 'tbl_products',
      name: 'Products',
      schema: 'public',
      kind: 'table',
      visibleOnCanvas: false,
      position: { x: 40, y: 310 },
      columns: [
        { name: 'product_id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'varchar(255)', nullable: false },
        {
          name: 'category_id',
          type: 'int',
          nullable: false,
          isForeignKey: true,
          references: { table: 'categories', column: 'category_id' },
        },
        {
          name: 'supplier_id',
          type: 'int',
          nullable: false,
          isForeignKey: true,
          references: { table: 'suppliers', column: 'supplier_id' },
        },
        { name: 'description', type: 'text', nullable: true },
      ],
      indexes: [
        { name: 'category_id', columns: ['category_id'], unique: false },
        { name: 'supplier_id', columns: ['supplier_id'], unique: false },
      ],
    },
    {
      id: 'tbl_regions',
      name: 'regions',
      schema: 'public',
      kind: 'table',
      visibleOnCanvas: true,
      position: { x: 540, y: 120 },
      columns: [
        { name: 'region_id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'varchar (255)', nullable: false },
      ],
      indexes: [],
    },
  ],
  relations: [],
};

export const TARGET_INVENTORY_SCHEMA: SchemaGraph = {
  dialect: 'postgresql',
  nodes: [
    {
      id: 'tbl_products',
      name: 'Products',
      schema: 'public',
      kind: 'table',
      visibleOnCanvas: false,
      position: { x: 40, y: 310 },
      columns: [
        { name: 'product_id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'varchar(255)', nullable: false },
        {
          name: 'category_id',
          type: 'int',
          nullable: false,
          isForeignKey: true,
          references: { table: 'categories', column: 'category_id' },
        },
        {
          name: 'supplier_id',
          type: 'int',
          nullable: false,
          isForeignKey: true,
          references: { table: 'suppliers', column: 'supplier_id' },
        },
        { name: 'description', type: 'text', nullable: true },
        { name: 'price', type: 'decimal (10,2)', nullable: false, defaultValue: '0.00' },
      ],
      indexes: [
        { name: 'category_id', columns: ['category_id'], unique: false },
        { name: 'supplier_id', columns: ['supplier_id'], unique: false },
      ],
    },
    {
      id: 'view_price_avgs',
      name: 'price_avgs',
      schema: 'public',
      kind: 'view',
      visibleOnCanvas: true,
      position: { x: 100, y: 120 },
      createStatement:
        'CREATE OR REPLACE VIEW "public"."price_avgs" AS\nSELECT\n  r."name" AS "category_name",\n  AVG(p."price")::decimal(14,6) AS "avg-price"\nFROM "public"."Products" p\nJOIN "public"."regions" r\n  ON p."category_id" = r."region_id"\nGROUP BY r."name";',
      dependencies: ['public.Products', 'public.regions'],
      columns: [
        { name: 'category_name', type: 'varchar (255)', nullable: false },
        { name: 'avg-price', type: 'decimal (14, 6)', nullable: true },
      ],
      indexes: [],
    },
    {
      id: 'tbl_regions',
      name: 'regions',
      schema: 'public',
      kind: 'table',
      visibleOnCanvas: true,
      position: { x: 540, y: 120 },
      columns: [
        { name: 'region_id', type: 'int', nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'varchar (255)', nullable: false },
      ],
      indexes: [],
    },
  ],
  relations: [
    {
      id: 'rel_price_avgs_regions',
      sourceId: 'view_price_avgs',
      targetId: 'tbl_regions',
      sourceColumn: 'category_name',
      targetColumn: 'region_id',
      kind: 'view_dep',
      label: 'GROUP BY r.name -> regions.region_id',
    },
  ],
};

export function createSeedOperationalData(workspaceId: string): {
  migrations: MigrationDTO[];
  ciRuns: CiRunDTO[];
  webhooks: WebhookDTO[];
  tags: TagDTO[];
} {
  const now = new Date();
  const earlier = new Date(now.getTime() - 1000 * 60 * 60 * 18);
  const twoDaysAgo = new Date(now.getTime() - 1000 * 60 * 60 * 48);

  return {
    migrations: [
      {
        id: `mig_${workspaceId}_1`,
        workspaceId,
        datasourceId: null,
        version: '20240112093000',
        name: 'init_inventory_tables',
        upSql:
          'CREATE TABLE "public"."regions" (\n  "region_id" int PRIMARY KEY,\n  "name" varchar(255) NOT NULL\n);\n\nCREATE TABLE "public"."Products" (\n  "product_id" int PRIMARY KEY,\n  "name" varchar(255) NOT NULL,\n  "category_id" int NOT NULL,\n  "supplier_id" int NOT NULL,\n  "description" text\n);',
        downSql:
          'DROP TABLE IF EXISTS "public"."Products";\nDROP TABLE IF EXISTS "public"."regions";',
        status: 'applied',
        appliedAt: twoDaysAgo.toISOString(),
        createdAt: twoDaysAgo.toISOString(),
      },
      {
        id: `mig_${workspaceId}_2`,
        workspaceId,
        datasourceId: null,
        version: '20240208141500',
        name: 'add_product_price_and_price_avgs_view',
        upSql:
          'ALTER TABLE "public"."Products"\n  ADD COLUMN "price" decimal(10,2) NOT NULL DEFAULT 0.00;\n\nCREATE OR REPLACE VIEW "public"."price_avgs" AS\nSELECT r."name" AS "category_name", AVG(p."price")::decimal(14,6) AS "avg-price"\nFROM "public"."Products" p\nJOIN "public"."regions" r ON p."category_id" = r."region_id"\nGROUP BY r."name";',
        downSql:
          'DROP VIEW IF EXISTS "public"."price_avgs";\nALTER TABLE "public"."Products" DROP COLUMN IF EXISTS "price";',
        status: 'pending',
        appliedAt: null,
        createdAt: earlier.toISOString(),
      },
    ],
    ciRuns: [
      {
        id: `ci_${workspaceId}_1`,
        workspaceId,
        branch: 'feat/pricing-analytics-view',
        commitSha: '9f4c2a8',
        author: 'schema-bot',
        status: 'passed',
        summary: '2 additive changes verified without destructive lock impact',
        diffCount: 2,
        durationMs: 1420,
        checks: [
          {
            name: 'Destructive Change Guard',
            status: 'passed',
            detail: 'No DROP TABLE or DROP COLUMN statements detected.',
          },
          {
            name: 'View Dependency Check',
            status: 'passed',
            detail: 'price_avgs references public.Products and public.regions cleanly.',
          },
          {
            name: 'Migration Reversibility',
            status: 'passed',
            detail: 'Down migration generated and syntax-checked for PostgreSQL.',
          },
        ],
        createdAt: earlier.toISOString(),
      },
      {
        id: `ci_${workspaceId}_2`,
        workspaceId,
        branch: 'main',
        commitSha: '3b81e04',
        author: 'release-pipeline',
        status: 'passed',
        summary: 'Baseline inventory schema applied to staging',
        diffCount: 2,
        durationMs: 980,
        checks: [
          {
            name: 'Index Coverage',
            status: 'passed',
            detail: 'category_id and supplier_id indexes verified on Products.',
          },
        ],
        createdAt: twoDaysAgo.toISOString(),
      },
    ],
    webhooks: [
      {
        id: `wh_${workspaceId}_1`,
        workspaceId,
        name: 'Slack Schema Drift Alerts',
        url: 'https://hooks.example.com/services/dblens-alerts',
        events: ['schema.diff.detected', 'migration.applied'],
        enabled: true,
        lastTriggeredAt: earlier.toISOString(),
        createdAt: twoDaysAgo.toISOString(),
      },
    ],
    tags: [
      {
        id: `tag_${workspaceId}_1`,
        workspaceId,
        name: 'v2024.02-pricing',
        color: '#16A34A',
        targetSnapshotId: null,
        description: 'Added price column and price_avgs analytical view',
        createdAt: earlier.toISOString(),
      },
      {
        id: `tag_${workspaceId}_2`,
        workspaceId,
        name: 'v2024.01-baseline',
        color: '#2563EB',
        targetSnapshotId: null,
        description: 'Initial inventory products & regions baseline',
        createdAt: twoDaysAgo.toISOString(),
      },
    ],
  };
}
