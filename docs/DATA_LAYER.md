# LaLeMe 数据层说明

## 当前策略

生产数据源固定为 Hosted Supabase/Postgres。Web 前端不使用 mock data，不读取 seed fixture，不在写入失败后保留本地-only 状态。

前端通过服务端 API 访问数据库：

- `GET /api/toilets`：按地图 bbox 或中心点读取厕所，默认限量返回。
- `POST /api/toilets`：新增用户贡献厕所。
- `POST /api/toilets/:id/status`：写入开放/厕纸/清洁状态。
- `POST /api/toilets/:id/reviews`：写入评分评论。
- `POST /api/toilets/:id/paper-requests`：发起厕纸求助。
- `PATCH /api/paper-requests/:id`：标记求助解决。
- `POST /api/reports`：提交举报。

所有写入成功后，页面重新读取数据库，确保列表、地图和详情来自同一个真源。

## 数据表

主要表：

- `regions`
- `places`
- `toilets`
- `toilet_status_updates`
- `toilet_reviews`
- `paper_requests`
- `reports`
- `osm_sync_runs`

`toilets` 表包含 OSM 来源字段：`osm_type`、`osm_id`、`source`、`source_license`、`source_attribution`、`source_tags`、`last_imported_at`、`source_status`、`source_missing_since`。

生产迁移会移除 mock 地图坐标列 `map_x` / `map_y`，并为 `latitude` / `longitude` 增加查询索引。

## OSM 导入

OSM 导入脚本使用 Geofabrik `.osm.pbf` extracts 和 `osmium`，只导入 `amenity=toilets`。它不会在用户打开网页时请求 OSM、Overpass 或商业地图 POI。

示例：

```bash
npm run osm:sync:dry -- --geofabrik-id=monaco --limit=20
npm run osm:sync -- --geofabrik-id=hong-kong
```

导入通过数据库 RPC `import_osm_toilets` 批量 upsert。重复导入按 `osm_type + osm_id` 去重。再次同步只更新 OSM 来源字段、名称、坐标、tags 和导入时间，不覆盖用户贡献字段。

完整 Geofabrik extract 导入后，脚本会调用 `finalize_osm_toilet_sync` 做生命周期收尾：

- 当前 OSM 仍存在的点位保持 `source_status='active'`。
- 当前 OSM 新增的点位插入数据库。
- 当前 OSM 消失且没有用户状态、评论、求助或举报记录的点位会被删除。
- 当前 OSM 消失但已有任一用户记录的点位会保留，并设置 `source_status='needs_verification'` 和 `source_missing_since`。
- `source='user'` 的用户贡献点位不参与 OSM 覆盖或删除。

带 `--limit` 的局部同步不会执行删除收尾，只能用于开发 dry run 或小样本检查。

Hosted Supabase/Postgres 是唯一生产真源。Supabase 或 Web 服务重启后，地图点位从数据库重新读取，不依赖浏览器内存、本地缓存或 mock 数据。

## 生产配置

必需变量：

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_TOKEN=
NEXT_PUBLIC_MAP_STYLE_URL=https://your-map-style.example.com/style.json
NEXT_PUBLIC_DEFAULT_MAP_LATITUDE=22.319300
NEXT_PUBLIC_DEFAULT_MAP_LONGITUDE=114.169400
```

检查：

```bash
npm run check:prod-config
```

这个检查会阻止本地 Supabase URL、缺失 service role、缺失 admin token、缺失真实 MapLibre style URL 和缺失默认地图中心。
