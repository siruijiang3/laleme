# LaLeMe Open Data / 拉了么开放数据

LaLeMe publishes a read-only public toilet dataset through a stable API. The dataset is intended for maps, research, accessibility tools, civic projects, and other public-interest reuse.

拉了么通过稳定的只读 API 发布公共厕所开放数据。数据可用于地图、研究、无障碍工具、公益项目和其他公共利益用途。

## License / 许可证

The first public dataset is released under the Open Data Commons Open Database License 1.0 (`ODbL-1.0`).

第一版开放数据使用 Open Data Commons Open Database License 1.0（`ODbL-1.0`）发布。

Attribution must include:

- `OpenStreetMap contributors` for OSM-derived records.
- `LaLeMe contributors` for user-contributed records.
- `LaLeMe contributors` as an additional attribution when an OSM-derived record includes community corrections.
- A link to the OSM copyright page when OSM data is used: `https://www.openstreetmap.org/copyright`.

署名应包含：

- OSM 来源点位：`OpenStreetMap contributors`
- 用户贡献点位：`LaLeMe contributors`
- OSM 来源点位如果包含社区修正，也应同时署名 `LaLeMe contributors`
- 使用 OSM 数据时，应链接到 `https://www.openstreetmap.org/copyright`

## Public API / 公开 API

```http
GET /api/public/toilets
```

The API requires a geographic filter. It will not return the whole database without bounds.

API 必须带地理范围筛选，不支持无范围读取全库。

Use a bbox:

```http
GET /api/public/toilets?south=22.1&west=113.8&north=22.6&east=114.4&limit=500
```

Or use a center point:

```http
GET /api/public/toilets?latitude=22.3193&longitude=114.1694&radiusKm=3&limit=500
```

Parameters:

| Name | Required | Description |
| --- | --- | --- |
| `south`, `west`, `north`, `east` | Required for bbox mode | Decimal degree bounding box |
| `latitude`, `longitude` | Required for center mode | Decimal degree center point |
| `radiusKm` | Optional | Radius around the center point; defaults to the service default |
| `limit` | Optional | Default `500`, maximum `1000` |

## Response Shape / 返回结构

```json
{
  "ok": true,
  "data": {
    "toilets": [
      {
        "id": "4156",
        "source": "osm",
        "osmType": "way",
        "osmId": 1217948245,
        "name": "OSM 公共厕所 way/1217948245",
        "latitude": 22.300435,
        "longitude": 114.186341,
        "placeName": "toilets",
        "floor": "未确认",
        "locationHint": null,
        "isAccessible": false,
        "status": {
          "isOpen": true,
          "hasPaper": true,
          "isClean": true,
          "updatedAt": null
        },
        "rating": {
          "average": 0,
          "count": 0
        },
        "sourceStatus": "active",
        "lastImportedAt": "2026-05-19T20:45:58.481747+00:00",
        "license": "ODbL-1.0",
        "attribution": "OpenStreetMap contributors"
      }
    ],
    "count": 1,
    "limit": 500,
    "truncated": false,
    "license": "ODbL-1.0",
    "attribution": ["OpenStreetMap contributors", "LaLeMe contributors"]
  }
}
```

If `truncated` is `true`, query a smaller map area or lower radius.

如果 `truncated` 为 `true`，请缩小地图范围或降低半径后继续查询。

## Included Data / 包含的数据

The public API includes:

- Toilet identity and source.
- OSM identity when available.
- Name, coordinates, place name, floor, and location hint. Name/place/floor use LaLeMe community corrections first when available.
- Accessibility flag.
- Latest status summary: open, paper, clean, update time.
- Rating summary: average and count.
- Source status and import timestamp.
- License and attribution.

公开 API 包含：

- 厕所身份和来源。
- 可用时包含 OSM identity。
- 名称、坐标、地点名、楼层和位置提示。存在 LaLeMe 社区修正时优先返回修正值。
- 无障碍标记。
- 最新状态汇总：开放、厕纸、清洁、更新时间。
- 评分汇总：平均分和数量。
- 来源状态和导入时间。
- 许可证和署名。

## Excluded Data / 不公开的数据

The public API does not include:

- Review body text.
- Paper request body text.
- Reports, report details, or admin status.
- Author names beyond generic attribution.
- Service role keys, admin tokens, or deployment secrets.
- Raw Supabase direct table access.

公开 API 不包含：

- 评论正文。
- 厕纸求助正文。
- 举报、举报详情或 admin 处理状态。
- 除通用署名之外的作者名称。
- service role key、admin token 或部署密钥。
- Supabase 原始表直连访问。

## Source Notes / 来源说明

OpenStreetMap data is imported from Geofabrik extracts and filtered to `amenity=toilets`. OSM records are a baseline only; users can still confirm real-world status, correct displayed name/place/floor, add missing toilets, and report incorrect records. Later OSM syncs do not overwrite LaLeMe community correction fields.

OSM 数据来自 Geofabrik extracts，并只筛选 `amenity=toilets`。OSM 点位只是数据底座；用户仍可确认真实状态、修正显示名称/地点/楼层、补充缺失厕所和举报错误点位。后续 OSM 同步不会覆盖 LaLeMe 社区修正字段。
