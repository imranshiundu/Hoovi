# HooviDB - The Universal Data Mesh

HooviDB is a massive, unified catalog and database interface designed to seamlessly aggregate and normalize data from across the open web.

## Architecture 

The system acts as a high-performance, intelligent middle-layer between the user interface and the chaotic landscape of public data sources.

```
HooviDB Frontend
        ↓
HooviDB Backend API (Vercel Serverless / Node.js)
        ↓
Resolvers / Crawlers / Open APIs / Dumps / Public catalogs
        ↓
Normalized HooviDB records
```

### Supported Data Formats and Sources
HooviDB is engineered to handle the biggest datasets without flinching. Through dynamic resolvers, it connects to:
- **Free / No-Key APIs** (Direct REST integration)
- **Public JSON Feeds & RSS/Atom**
- **SPARQL & GraphQL Endpoints**
- **CSV Dumps & Open Data Portals**
- **S3 / Open Cloud Buckets**
- **BigQuery Public Datasets**
- **GitHub Raw Files & Repositories**
- **Torrents, Archives, and Mega-Catalogs**

## Scalability & Protection Against Depletion

Hosting large-scale systems on platforms like Vercel is highly cost-effective (free for many use-cases), but rapid API requests can quickly deplete serverless execution limits (tokens) and lead to rate-limits from upstream data providers. 

To prevent this and utilize Javascript to its absolute fullest advantage, **HooviDB employs a Multi-Tier Caching Strategy**:

1. **Vercel Edge Caching (CDN):** 
   Our endpoints inject `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` headers. This tells Vercel's global CDN to cache the raw JSON output at the edge for 1 hour. If 1,000 users search for the exact same query, the Vercel Edge handles 999 of them instantly. Your serverless function is only invoked **once**, costing zero extra compute tokens.
   
2. **In-Memory Application Cache:** 
   Inside the backend layer, a blazing-fast local memory `Map` caches upstream provider data (like GitHub or TVMaze). If multiple concurrent requests hit the backend, the Node.js memory intercepts them instantly, protecting you from being IP-banned or rate-limited by the source APIs.
   
3. **Graceful Degradation:**
   If a single data provider (e.g., GitHub Search) goes down or rate-limits the backend, HooviDB catches the error seamlessly without crashing the entire dashboard. The failed node simply returns an empty array, while the rest of the database queries continue functioning perfectly.

## The Mega Catalog

HooviDB's central brain is powered by `hoovidb.json` - a massive, unified JSON schema aggregating over **10,000+** open APIs, dataset directories, and internet data meshes into a single, highly queryable index.

By protecting frontend keys and enforcing serverless multi-tier caching, HooviDB serves as the ultimate, hyper-fast window into the world's public data.
