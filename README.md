# LaLeMe / 拉了么

LaLeMe is an open public-toilet map. Users can find nearby toilets, add missing toilets, update real-world status, leave ratings and comments, ask for toilet paper help, and report bad data.

拉了么是一个开放厕所地图平台。用户可以查找附近厕所、补充缺失点位、更新真实状态、评分评论、发起厕纸求助，并举报错误数据。

Current production-style stack:

- Next.js + React + TypeScript
- MapLibre GL JS for the map UI
- Hosted Supabase/Postgres as the only production database
- OpenStreetMap Geofabrik extracts as the open-data base layer
- Vercel for Web deployment
- GitHub Actions for scheduled OSM sync

当前项目不是校园限定 app。首页以“附近厕所”和“当前地图范围”为主，目标场景包括商场、地铁站、机场、景区、公园、办公园区和城市街区。

## Current Deployment / 当前线上地址

Current Vercel production URL:

```text
https://laleme-three.vercel.app
```

This is a Vercel default domain and may be replaced by a custom domain later. In mainland China, Vercel default domains may be blocked or unstable; see [Custom Domain / 改网址](#custom-domain--改网址).

当前线上地址是 Vercel 默认域名，后续可以换成正式自定义域名。在中国大陆网络下，Vercel 默认域名可能被阻断或不稳定，处理方式见“改网址”章节。

## Status / 当前状态

- Production Web/PWA prototype is implemented.
- The Web app reads and writes Hosted Supabase only.
- Mock data, seed fixture data, placeholder maps, local-only writes, and local Supabase fallback are intentionally not part of production.
- Frontend reads toilets by map bounds / center, not by loading the whole global table.
- OSM data is imported into this project's database offline; the Web page does not call OSM, Overpass, Amap, Baidu, Google, or Apple Maps for toilet POI at runtime.

中文说明：

- 当前是生产标准 Web/PWA 原型。
- 生产环境只读写 Hosted Supabase。
- 不保留 mock 数据、seed 假数据、占位地图、本地-only 写入或本地 Supabase fallback。
- 前端按地图范围读取厕所，不一次性读取全球全表。
- OSM 数据通过脚本离线导入本项目数据库；网页运行时不实时请求 OSM/Overpass，也不使用高德、百度、Google、Apple Maps 或任何商业/闭源厕所 POI。

## What Users Can Do / 用户功能

Users can:

- View toilets on a real MapLibre map.
- Use current location or current map viewport to find nearby toilets.
- Click a marker or list item to open toilet details.
- Add a user-contributed toilet with coordinates, floor, and location hint.
- Update open status, paper status, cleanliness, and accessibility.
- Quickly report "no paper".
- Add ratings and comments.
- Create and resolve simple toilet-paper help requests.
- Report wrong or problematic data.
- Use a minimal admin page at `/admin` to review reports.

用户可以：

- 在真实地图上查看厕所点位。
- 根据当前位置或当前地图范围查看附近厕所。
- 点击地图 marker 或列表项打开厕所详情。
- 新增用户贡献厕所，填写坐标、楼层和位置提示。
- 更新开放状态、厕纸状态、清洁状态和无障碍信息。
- 快捷报告“没纸了”。
- 评分和评论。
- 发起和处理简单厕纸求助。
- 举报错误数据。
- 通过 `/admin` 的最小管理页面处理举报。

## Product Principles / 产品原则

- User contributions are the core source of truth for real-time status.
- OSM is an open-data base layer, not a replacement for user confirmation.
- Commercial or closed POI sources are not used.
- Production must use one shared Hosted Supabase database so all devices see the same data.
- Failed writes must not create local-only UI data.
- Large datasets must be queried by map bounds or pagination.
- Keep the product simple enough for ordinary users to understand.

中文原则：

- 用户贡献是实时状态的核心。
- OSM 只是开放数据底座，不替代用户现场确认。
- 不使用商业或闭源 POI 数据源。
- 生产环境必须使用同一个 Hosted Supabase 数据库，保证所有设备数据一致。
- 写入失败时不能在 UI 里伪造本地-only 数据。
- 大数据量必须按地图范围或分页读取。
- 保持产品足够简单，让普通用户能理解和使用。

## Architecture / 工作原理

```text
Browser
  |
  | MapLibre renders map tiles from NEXT_PUBLIC_MAP_STYLE_URL
  | API requests for toilets, status, reviews, paper requests, reports
  v
Next.js app on Vercel
  |
  | Server-side API routes validate requests and use Supabase server clients
  v
Hosted Supabase/Postgres
  |
  | Stores regions, places, toilets, status updates, reviews, paper requests, reports
  v
Persistent production data

GitHub Actions / local maintenance job
  |
  | Downloads Geofabrik .osm.pbf extracts
  | Filters amenity=toilets with osmium
  | Upserts OSM toilets and finalizes lifecycle
  v
Hosted Supabase/Postgres
```

中文解释：

浏览器只负责展示地图和操作界面。Next.js API 负责读写数据库。Supabase 保存所有厕所、状态、评论、求助和举报。OSM 同步脚本在后台运行，把开放数据导入数据库。网页本身不会实时请求 OSM。

## Data Model / 数据层

Main tables:

- `regions`: backend service areas / import regions
- `places`: place-level grouping
- `toilets`: toilet records from OSM or users
- `toilet_status_updates`: open / paper / clean / accessibility updates
- `toilet_reviews`: ratings and comments
- `paper_requests`: toilet paper help requests
- `reports`: user reports for bad data
- `osm_sync_runs`: OSM sync audit records

Important source fields on `toilets`:

- `source`: `osm` or `user`
- `osm_type`, `osm_id`: stable OSM identity for imported toilets
- `source_license`: currently `ODbL-1.0`
- `source_attribution`: currently `OpenStreetMap contributors`
- `source_tags`: original OSM tags
- `last_imported_at`
- `source_status`: for example `active` or `needs_verification`
- `source_missing_since`

OSM sync only updates source fields, coordinates, name, tags, and import timestamps. It must not overwrite user-contributed status, ratings, reviews, paper requests, reports, floor, or location hints.

## Repository Structure / 代码结构

```text
src/app/
  page.tsx                         Main Web app page
  toilet-map.tsx                   MapLibre map component
  admin/page.tsx                   Minimal report admin UI
  api/toilets/route.ts             Toilet list and create API
  api/toilets/[toiletId]/status    Status update API
  api/toilets/[toiletId]/reviews   Review API
  api/toilets/[toiletId]/paper-requests
  api/paper-requests/[helpId]      Paper request update API
  api/reports/route.ts             Public report API
  api/admin/reports/route.ts       Admin report API

src/lib/
  data-config.ts                   Production data-mode checks
  domain.ts                        Shared domain types and helpers
  supabase-server.ts               Supabase server client
  toilet-repository.ts             Database read/write repository
  toilet-service.ts                App-level toilet operations
  admin-server.ts                  Admin authentication helpers

scripts/
  check-prod-config.mjs            Production environment validation
  sync-osm-toilets.mjs             Geofabrik OSM toilet importer
  verify-osm-sync-lifecycle.mjs    QA script for OSM lifecycle rules

supabase/migrations/
  *.sql                            Database schema and RPC migrations

.github/workflows/
  osm-sync.yml                     Scheduled Guangdong OSM sync
```

## Environment Variables / 环境变量

Use `.env.production.example` as the production template. Do not commit real secrets.

使用 `.env.production.example` 作为生产配置模板。不要提交真实密钥。

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

OSM_GEOFABRIK_IDS=guangdong
OSM_GEOFABRIK_URLS=
OSM_GEOFABRIK_INDEX_URL=https://download.geofabrik.de/index-v1.json
OSM_CACHE_DIR=.data/osm
OSM_BATCH_SIZE=500
```

Rules:

- `NEXT_PUBLIC_SUPABASE_URL` must be a Hosted Supabase URL like `https://xxx.supabase.co`.
- Do not use `localhost`, `127.0.0.1`, `192.168.*`, or LAN Supabase URLs in production.
- `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_TOKEN` are server-only secrets. Never expose them to browser code.
- `NEXT_PUBLIC_MAP_STYLE_URL` must be a MapLibre style JSON URL.
- Do not use official `tile.openstreetmap.org` as a production tile CDN.
- `.env.production.local`, `.env.local`, `.data/`, `.vercel/`, `.next/`, and `node_modules/` must stay uncommitted.

中文规则：

- 生产 Supabase 地址必须是 `https://xxx.supabase.co`。
- 生产环境不能使用本机或局域网数据库地址。
- `SUPABASE_SERVICE_ROLE_KEY` 和 `ADMIN_TOKEN` 只能放在服务端、CI、cron 或部署平台 secrets。
- 地图 style 必须来自 `NEXT_PUBLIC_MAP_STYLE_URL`。
- 不要把 OpenStreetMap 官方瓦片服务器当生产 CDN。
- 本地密钥、缓存、构建产物和依赖目录都不能提交到 GitHub。

## Local Development / 本地运行

This project no longer needs a local database for normal work. Local runs should still point to Hosted Supabase or a deliberately separate test Supabase project.

这个项目日常不需要本地数据库。即使本地运行，也应该连接 Hosted Supabase，或者连接一个明确的测试 Supabase 项目。

```bash
npm install
npm run check:prod-config
npm run typecheck
npm run build
PORT=3000 npm run start
```

For development mode:

```bash
npm run dev
```

Production behavior is stricter than development behavior. If production Supabase or map config is missing, the app should show a configuration error instead of silently falling back to fake data.

## Deployment / 部署方法

Recommended production setup:

- GitHub private repository for source code.
- Vercel project connected to the GitHub repository.
- Hosted Supabase/Postgres for production data.
- GitHub Actions secrets for OSM sync.
- Vercel environment variables for Web runtime.

Vercel environment variables:

```text
APP_ENV
APP_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ADMIN_TOKEN
NEXT_PUBLIC_MAP_STYLE_URL
NEXT_PUBLIC_DEFAULT_MAP_LATITUDE
NEXT_PUBLIC_DEFAULT_MAP_LONGITUDE
```

GitHub Actions secrets for OSM sync:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OSM_GEOFABRIK_IDS
OSM_BATCH_SIZE
```

Typical deployment flow:

```bash
npm run check:prod-config
npm run typecheck
npm run build
npm audit --omit=dev

git add .
git commit -m "Describe the change"
git push origin main
```

Vercel deploys automatically after `git push` when the GitHub integration is connected.

中文部署流程：

1. 在 Supabase 里应用全部数据库 migration。
2. 在 Vercel 配置生产环境变量。
3. 在 GitHub repo secrets 配置 OSM 同步 secrets。
4. 本地检查通过后 push 到 `main`。
5. Vercel 自动构建和上线。
6. 打开生产 URL，确认地图、厕所列表和 API 正常。

## OpenStreetMap Sync / OSM 数据更新

LaLeMe imports only OpenStreetMap `amenity=toilets` from Geofabrik extracts.

拉了么第一阶段只导入 OpenStreetMap 的 `amenity=toilets`，来源是 Geofabrik extracts。

Requirements:

- OSM data license: ODbL.
- Attribution: `OpenStreetMap contributors`.
- Tool: `osmium`.
- The Web app never calls OSM or Overpass at runtime.

Install local dependency:

```bash
brew install osmium-tool
```

Dry run:

```bash
npm run osm:sync:dry -- --geofabrik-id=monaco --limit=20
```

Sync one region:

```bash
npm run osm:sync -- --geofabrik-id=guangdong
```

Force refresh downloaded extract:

```bash
npm run osm:sync -- --geofabrik-id=guangdong --refresh
```

Current GitHub Actions workflow:

- File: `.github/workflows/osm-sync.yml`
- Schedule: `0 19 * * *` UTC
- Default region: `guangdong`
- Manual input: `geofabrik_id`

Lifecycle rules:

- New OSM toilet: insert into database.
- Existing OSM toilet: update source fields, name, coordinates, tags, and import time.
- Deleted from OSM and no user records exist: delete from database.
- Deleted from OSM but user status/review/help/report exists: keep and mark `needs_verification`.
- User-contributed toilet with `source='user'`: never overwritten or deleted by OSM sync.
- Limited imports with `--limit` skip lifecycle finalization to avoid false deletion.

中文生命周期规则：

- OSM 新增厕所，本项目数据库新增。
- OSM 仍存在的厕所，只更新来源字段、名称、坐标、tags 和导入时间。
- OSM 删除且本地无人确认、无人评论、无人求助、无人举报，则本地删除。
- OSM 删除但本地已有用户记录，则保留并标记为 `needs_verification`。
- 用户自行贡献的厕所不会被 OSM 覆盖或删除。
- 带 `--limit` 的测试导入不会执行删除收尾。

## Expanding Coverage / 扩展到全国或全球

Start small before importing large regions.

建议先小范围验证，再扩大数据范围。

Examples:

```bash
npm run osm:sync -- --geofabrik-id=hong-kong
npm run osm:sync -- --geofabrik-id=guangdong
npm run osm:sync -- --geofabrik-id=china
```

If a country-level extract is too slow or too large, sync province-level extracts one by one. For China, useful Geofabrik IDs include:

```text
beijing
shanghai
tianjin
chongqing
guangdong
guangxi
fujian
zhejiang
jiangsu
shandong
hebei
henan
hubei
hunan
jiangxi
anhui
sichuan
yunnan
guizhou
hainan
liaoning
jilin
heilongjiang
shanxi
shaanxi
gansu
qinghai
ningxia
xinjiang
tibet
inner-mongolia
```

Before nationwide or global imports, check:

- Supabase storage and query performance.
- Vercel function limits for API routes.
- GitHub Actions timeout.
- OSM extract download size.
- Database indexes for latitude/longitude and source identity.
- Whether the UI still stays fast with dense markers.

The frontend is designed to query by map bounds, which is required for nationwide or global data.

## Custom Domain / 改网址

The Vercel default domain may be blocked or unstable in some networks. For public use, configure a custom domain.

Vercel custom domain flow:

1. Buy a domain.
2. Add it in Vercel project settings under Domains.
3. Configure DNS as Vercel instructs.
4. Update `APP_URL` in Vercel environment variables.
5. Redeploy.

For mainland China access, a Vercel custom domain alone may not be enough. A production path for China users may require:

- ICP filing if hosting in mainland China.
- Mainland China or Hong Kong hosting.
- A map tile/style provider reachable from China.
- Possibly migrating from Supabase to a China-accessible Postgres or backend later.

中文说明：

如果目标用户主要在中国大陆，建议先绑定正式域名测试。如果 Vercel 仍被网络阻断，再考虑国内云或香港云部署。域名、地图瓦片服务、数据库访问都需要一起考虑。

## Admin / 管理页面

The minimal admin page is:

```text
/admin
```

It is used to inspect and process reports. It depends on:

- `ADMIN_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY`

This is not a full user account system and not a full moderation backend.

中文说明：

`/admin` 是早期公开试用所需的最小举报处理页面，不是完整账号系统，也不是完整审核后台。

## Maintenance Checklist / 维护检查清单

Before shipping code changes:

```bash
npm run typecheck
npm run build
npm audit --omit=dev
npm run check:prod-config
```

When touching OSM sync:

```bash
node --check scripts/sync-osm-toilets.mjs
node --check scripts/verify-osm-sync-lifecycle.mjs
npm run osm:sync:dry -- --geofabrik-id=monaco --limit=20
npm run osm:verify-lifecycle
```

Operational checks:

- Vercel latest deployment should be `Ready`.
- GitHub latest commit status should be green.
- GitHub Actions `OSM Sync` should succeed.
- `/api/toilets?limit=1` should return `ok: true`.
- Production URL should render map and toilet list.
- Supabase should contain persistent records after refresh or redeploy.

## Troubleshooting / 常见问题

Website opens but no toilets:

- Check `NEXT_PUBLIC_SUPABASE_URL`.
- Check `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Check Supabase migrations.
- Check `/api/toilets?limit=1`.

Map is blank:

- Check `NEXT_PUBLIC_MAP_STYLE_URL`.
- Check whether the style URL is reachable.
- Check whether the tile provider works in the user's network.

New toilet disappears after refresh:

- The write probably failed.
- Check API response and Supabase rows.
- Production must not create local-only toilets.

GitHub shows a failed old commit:

- Check the current `main` commit SHA.
- A historical failed commit can remain visible even after a newer successful commit replaces it.
- The important state is the latest `main` commit and the current Vercel production deployment.

OSM sync fails:

- Check GitHub Actions secrets.
- Check `osmium` installation in the runner.
- Check Geofabrik ID spelling.
- Check Supabase service role key.
- Run dry-run locally with a small extract first.

## For AI Agents / 给 AI Agent 的规则

Read these files before making changes:

- `README.md`
- `ROADMAP.md`
- `AGENTS.md`

Do:

- Keep production data source as Hosted Supabase.
- Keep user data protected from OSM overwrite.
- Query large toilet datasets by bounds or pagination.
- Keep environment examples secret-free.
- Run the relevant checks after changes.
- Explain operational consequences in plain language.

Do not:

- Reintroduce mock data, seed fixtures, placeholder maps, or local-only writes.
- Hardcode map tokens or production secrets.
- Use commercial or closed POI providers.
- Use OpenStreetMap official tile servers as a production CDN.
- Add a complex account system, recommendation system, chat system, or large cloud architecture unless explicitly requested.
- Claim unfinished features are complete.

中文规则：

- 修改前先读 `README.md`、`ROADMAP.md` 和 `AGENTS.md`。
- 不要重新引入 mock、seed、占位地图或本地-only 写入。
- 不要提交真实密钥。
- 不要接入高德、百度、Google、Apple Maps 或商业 POI。
- 不要把 OSM 同步设计成前端实时请求。
- 不要一次性读取全球厕所全表。
- 修改后必须做检查，并在总结中说明结果。

## License / 许可证

This project is licensed under AGPL-3.0-or-later. See `LICENSE`.

本项目使用 AGPL-3.0-or-later 许可证。详见 `LICENSE`。
