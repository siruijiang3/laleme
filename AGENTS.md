# AGENTS.md

这个文件写给未来参与 LaLeMe 的 Codex agent 和其他自动化开发助手。

## 项目目标

LaLeMe 是一个开放厕所地图平台。用户可以在地图上查找、标注、更新和评论厕所，并在需要时发起简单的厕纸求助。

项目不是校园限定 app。生产体验以“附近厕所”和“当前地图范围”为主，必须支持商场、地铁站、机场、景区、公园、办公园区、城市街区等真实区域。

## 当前阶段

当前阶段是生产标准 Web/PWA 原型。

项目使用 Next.js + TypeScript、MapLibre GL JS 和 Hosted Supabase/Postgres。生产数据源只有 Supabase；不保留 mock data、seed fixture、占位地图、local-only 写入或本地 Supabase fallback。

前端按地图 bbox/中心点通过服务端 API 读取厕所，不要一次性读取全球全表。所有新增厕所、状态更新、评论、厕纸求助和举报都必须先写入生产数据库成功，再刷新 UI。

项目通过命令行脚本把 OpenStreetMap Geofabrik extracts 中的 `amenity=toilets` 导入数据库作为开放数据底座。OSM 数据不是实时前端依赖，也不能覆盖用户贡献的状态、评分、评论、求助、举报、楼层和方位。

当前 Web 原型有一个最小 admin 页面用于处理举报，路径是 `/admin`。它依赖服务端环境变量 `ADMIN_TOKEN` 和 `SUPABASE_SERVICE_ROLE_KEY`，只用于早期试用运营闭环，不代表完整账号或审核后台。

项目开放数据通过 `GET /api/public/toilets` 提供。这个 API 只能返回厕所点位和状态汇总，不得返回评论正文、厕纸求助正文、举报、admin 数据、服务端密钥或 Supabase 原始表直连能力。

## 技术约束

- 优先 Web/PWA。
- iOS 原生 App 放到后续阶段。
- 地图使用 MapLibre GL JS。
- 地图 style URL 必须来自 `NEXT_PUBLIC_MAP_STYLE_URL`，不要硬编码地图 token。
- 不要使用 OpenStreetMap 官方 tile server 作为生产 CDN。
- 生产 Supabase URL 必须是 `https://*.supabase.co`。
- 禁止生产配置使用 `localhost`、`127.0.0.1`、`192.168.*` 或局域网 Supabase URL。
- `SUPABASE_SERVICE_ROLE_KEY` 和 `ADMIN_TOKEN` 只能保存在本地未提交 env、部署平台 secrets、CI 或 cron secrets 中，不能暴露给浏览器。
- 浏览器和第三方只能通过 Next.js API 访问数据；不要重新开放 Supabase anon 对原始业务表的直接读写权限。
- OSM 同步只能使用开放许可数据，当前只允许 `amenity=toilets`，并保留 ODbL attribution。
- 不接入高德、百度、Google、Apple Maps 或任何商业/闭源 POI。
- 不在第一阶段引入复杂账号、复杂审核后台、推荐系统、实时聊天或复杂云架构。
- 不提交真实密钥、真实数据库密码或私人配置。

## 工作规则

- 修改前先阅读 `README.md`、`ROADMAP.md` 和本文件。
- 保持改动小而清楚。
- 不要重新引入 mock data、seed fixture、占位地图或本地-only 写入。
- 不要把现有 `/api/toilets` 当开放数据接口；开放数据只维护 `/api/public/toilets`。
- 不要用“大平台架构”替代当前生产原型。
- 不要把尚未实现的功能写成已经完成。
- 不要引入新框架、服务或依赖，除非当前任务明确需要。
- 涉及全球数据时，必须按地图范围分页/限量读取，避免全表拉取。
- 修改 `.env.example` 时只放占位值，不放真实凭据。
- 涉及数据字段、接口、地图行为时，先考虑普通用户是否能理解和使用。

## 修改后的检查要求

每次修改后都必须做运行检查或内容检查。

当前代码检查至少运行：

- `npm run typecheck`
- `npm run build`
- `npm audit --omit=dev`
- `npm run check:prod-config`

如果涉及 OSM 同步脚本，还要运行：

- `node --check scripts/sync-osm-toilets.mjs`
- `npm run osm:sync:dry -- --geofabrik-id=monaco --limit=20`

如果本机缺少真实 Hosted Supabase 配置或 `osmium`，必须在最终说明里明确指出，不能假装完成真实导入或生产启动。
