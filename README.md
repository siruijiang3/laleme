# LaLeMe / 拉了么

LaLeMe 是一个开放厕所地图平台。用户可以在真实地图上查找厕所、贡献点位、更新开放/厕纸/清洁状态、评分评论、发起厕纸求助和举报问题。

项目不是校园限定 app。生产版以“附近厕所”和“当前地图范围”为入口，厕所数据来自 LaLeMe 自己的 Hosted Supabase/Postgres 数据库，不来自高德、百度、Google、Apple Maps 或任何商业/闭源 POI。

## 生产数据原则

- 生产环境只读写同一个 Hosted Supabase/Postgres。
- 不使用 mock data、seed fixture、占位地图或本地-only UI 状态。
- 新增厕所、状态更新、“没纸了”、评论、厕纸求助和举报都必须写入数据库成功后才更新 UI。
- 前端按地图 bbox/中心点请求 `/api/toilets`，不会一次性读取全球全表。
- Web 页面不会实时请求 OSM、Overpass 或商业地图 POI。

## 环境变量

复制 `.env.production.example` 为 `.env.production.local`，填入真实生产配置：

```env
APP_ENV=production
APP_URL=https://your-laleme-domain.example

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_TOKEN=

NEXT_PUBLIC_MAP_STYLE_URL=https://your-map-style.example.com/style.json
NEXT_PUBLIC_DEFAULT_MAP_LATITUDE=22.319300
NEXT_PUBLIC_DEFAULT_MAP_LONGITUDE=114.169400

OSM_GEOFABRIK_IDS=hong-kong
OSM_CACHE_DIR=.data/osm
OSM_BATCH_SIZE=500
```

要求：

- `NEXT_PUBLIC_SUPABASE_URL` 必须是 `https://*.supabase.co`。
- 不要使用 `localhost`、`127.0.0.1`、`192.168.*` 或局域网 Supabase URL。
- `SUPABASE_SERVICE_ROLE_KEY` 和 `ADMIN_TOKEN` 只放服务端、CI、cron 或部署平台 secrets。
- `NEXT_PUBLIC_MAP_STYLE_URL` 必须是 MapLibre style JSON URL。
- 不要把 OpenStreetMap 官方 tile server 当作生产 CDN。

## 本地生产启动

```bash
npm install
npm run check:prod-config
npm run build
PORT=3000 npm run start
```

`http://192.168...:3000` 只适合局域网预览，不是生产数据一致方案。正式公开试用应使用同一个 HTTPS 域名访问同一个 Hosted Supabase 数据库。

## Supabase 数据层

迁移文件在 `supabase/migrations/`。生产数据库需要应用全部迁移，包括：

- 初始表：`regions`、`places`、`toilets`、`toilet_status_updates`、`toilet_reviews`、`paper_requests`、`reports`
- OSM 来源字段：`osm_type`、`osm_id`、`source`、`source_license`、`source_attribution`、`source_tags`、`last_imported_at`、`source_status`、`source_missing_since`
- 生产清理：删除 seed fixture、移除 mock 坐标列、增加经纬度索引、增加 `import_osm_toilets` RPC

`supabase/seed.sql` 是 no-op。生产不加载校园/商场/地铁站 seed 数据。

## OpenStreetMap 数据底座

第一阶段只导入 OpenStreetMap 的 `amenity=toilets`。OSM 数据采用 ODbL，需要 attribution；本项目保留 `OpenStreetMap contributors`、`ODbL-1.0` 和原始 tags。

导入方式使用 Geofabrik `.osm.pbf` extracts 和 `osmium`：

```bash
brew install osmium-tool
npm run osm:sync:dry -- --geofabrik-id=monaco --limit=20
npm run osm:sync -- --geofabrik-id=hong-kong
```

全球导入使用分区 extracts：

```bash
npm run osm:sync -- --all-geofabrik
```

生产建议先从目标国家/城市或小 extract 验证，再按 continent/country 分批跑。下载缓存放在 `.data/osm/`，不会提交到仓库。

重复导入按 `osm_type + osm_id` upsert，不产生重复厕所。再次同步只更新 OSM 来源字段、名称、坐标、tags 和导入时间；不会覆盖用户贡献的实时状态、评分、评论、楼层、方位、厕纸状态、求助和举报。

每次完整 Geofabrik extract 同步完成后，脚本会执行一次 OSM 生命周期收尾：

- OSM 新增的 `amenity=toilets` 会插入本项目数据库。
- OSM 仍存在的厕所会继续更新 OSM 来源字段。
- OSM 已删除、且本地没有状态、评论、厕纸求助或举报记录的厕所，会从本项目数据库删除。
- OSM 已删除、但本地已有任一用户记录的厕所不会删除，会标记为 `needs_verification`，提醒用户现场确认。
- `source='user'` 的用户自行贡献厕所不会被 OSM 同步覆盖或删除。

带 `--limit` 的局部导入只用于开发验证，不会执行删除收尾，避免把未导入的真实点位误判为 OSM 已删除。

## 定时同步

GitHub Actions、Vercel Cron 或服务器 cron 都应使用同一套 Hosted Supabase secrets。

服务器 cron 示例：

```cron
0 3 * * * cd /path/to/laleme && npm run osm:sync -- --geofabrik-id=hong-kong >> /var/log/laleme-osm-sync.log 2>&1
```

## 检查命令

```bash
npm run typecheck
npm run build
npm audit --omit=dev
npm run check:prod-config
node --check scripts/sync-osm-toilets.mjs
node --check scripts/verify-osm-sync-lifecycle.mjs
npm run osm:verify-lifecycle
```

## 管理页面

最小 admin 页面在 `/admin`，用于处理举报。它需要 `ADMIN_TOKEN` 和 `SUPABASE_SERVICE_ROLE_KEY`，不代表完整账号系统或复杂审核后台。

## 下一步

- 配置真实 Hosted Supabase 和地图 style。
- 应用生产迁移。
- 先导入一个小 Geofabrik extract 验证数据链路。
- 再按目标上线区域扩大 OSM 导入范围。
